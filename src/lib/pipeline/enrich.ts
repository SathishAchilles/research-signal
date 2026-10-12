import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sources } from "@/db/schema";
import { fetchDetail, insertSignals, type SignalInput, writeHfSignals } from "@/lib/sources/hf";
import { matchVenue } from "@/lib/sources/openreview";
import { getEnabledSources, getSourceSecret } from "@/lib/sources/registry";
import { type RunStatus, finishRun, startRun } from "@/lib/sources/runs";
import { batchLookup } from "@/lib/sources/s2";
import { SourceUnavailable, type SourceKind, errorMessage } from "@/lib/sources/types";
import { rankAll } from "./rank";

export const ENRICH_WINDOW_DAYS = 14;
const HF_DETAIL_LIMIT = 150;
const OPENREVIEW_RECHECK_DAYS = 7;
const OPENREVIEW_CURSOR_DAYS = 30;
const DAY_MS = 86_400_000;

export type SourceOutcome = { status: RunStatus; items: number; error?: string };
export type EnrichResult = {
  hf: SourceOutcome;
  openreview: SourceOutcome;
  s2: SourceOutcome;
  ranked: number;
  promoted: number;
};

const recent = sql.raw(
  `coalesce(p.announced_at, p.submitted_at, p.created_at) >= now() - interval '${ENRICH_WINDOW_DAYS} days'`,
);

const skipped = (error: string): SourceOutcome => ({ status: "SKIPPED", items: 0, error });

async function tracked(kind: SourceKind, fn: () => Promise<SourceOutcome>): Promise<SourceOutcome> {
  const runId = await startRun(kind, "enrich");
  let outcome: SourceOutcome;
  try {
    outcome = await fn();
  } catch (error) {
    outcome = {
      status: error instanceof SourceUnavailable ? "PARTIAL" : "FAILED",
      items: 0,
      error: errorMessage(error),
    };
  }
  await finishRun(runId, outcome.status, outcome.items, outcome.error);
  return outcome;
}

// Shortlisted-or-better papers without an HF detail snapshot from today. Signals rows carry every field
// forward and have no source column, so a detail snapshot is a row captured during one of today's finished
// HF detail runs (enrich or hf_refresh). An unfinished run is ignored so a crashed one never hides papers.
async function enrichHf(): Promise<SourceOutcome> {
  const rows = await db.execute<{ arxiv_id: string }>(sql`
    select p.arxiv_id
    from research_signal.papers p
    left join lateral (
      select max(pd.final_score) as best from research_signal.paper_domain pd where pd.paper_id = p.id
    ) s on true
    where p.arxiv_id is not null
      and p.status in ('SHORTLISTED', 'SCORED', 'FINALIST')
      and ${recent}
      and not exists (
        select 1 from research_signal.signals sg
        join research_signal.source_runs r on r.source_kind = 'hf' and r.stage in ('enrich', 'hf_refresh')
          and r.started_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
          and r.finished_at is not null and sg.captured_at between r.started_at and r.finished_at
        where sg.paper_id = p.id
      )
    order by (p.status = 'FINALIST') desc, s.best desc nulls last, p.created_at desc
    limit ${HF_DETAIL_LIMIT}`);
  if (rows.length === 0) return { status: "OK", items: 0 };
  const details = await fetchDetail(rows.map((r) => r.arxiv_id), await getSourceSecret("hf"));
  const written = await writeHfSignals(details);
  if (details.failed > 0) {
    return { status: "PARTIAL", items: written, error: `${details.failed} of ${rows.length} HF detail requests failed` };
  }
  return { status: "OK", items: written };
}

type OpenReviewCursor = { checked?: Record<string, string> };

function openReviewQuota(params: unknown, now: Date): number {
  const p = (params ?? {}) as { maxPerDay?: number; maxPerSunday?: number };
  return now.getUTCDay() === 0 ? (p.maxPerSunday ?? 15) : (p.maxPerDay ?? 10);
}

// sources.cursor.checked records when each paper was last looked up, so unknown or still-under-review
// papers are searched again only after OPENREVIEW_RECHECK_DAYS. An unexpected error still writes the
// matches found before it and is reported as FAILED with that count; it is never replaced by a later
// insert or cursor error.
async function enrichOpenReview(params: unknown): Promise<SourceOutcome> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const [row] = await db.select({ cursor: sources.cursor }).from(sources).where(eq(sources.kind, "openreview"));
  const checked: Record<string, string> = {};
  for (const [id, day] of Object.entries((row?.cursor as OpenReviewCursor | null)?.checked ?? {})) {
    if (now.getTime() - Date.parse(day) < OPENREVIEW_CURSOR_DAYS * DAY_MS) checked[id] = day;
  }
  const quota = openReviewQuota(params, now) - Object.values(checked).filter((d) => d === today).length;
  if (quota <= 0) return skipped("daily OpenReview quota used");

  const recheckAfter = new Date(now.getTime() - OPENREVIEW_RECHECK_DAYS * DAY_MS).toISOString().slice(0, 10);
  const candidates = await db.execute<{ id: string; title: string }>(sql`
    select p.id, p.title
    from research_signal.papers p
    left join research_signal.latest_signals ls on ls.paper_id = p.id
    left join lateral (
      select max(pd.final_score) as best from research_signal.paper_domain pd where pd.paper_id = p.id
    ) s on true
    where p.status = 'FINALIST' and ${recent}
      and ls.or_decision is null
    order by s.best desc nulls last`);
  const due = candidates.filter((c) => !checked[c.id] || checked[c.id] < recheckAfter).slice(0, quota);

  const rows: SignalInput[] = [];
  let looked = 0;
  let written = 0;
  let error: string | undefined;
  let failure: unknown;
  try {
    for (const paper of due) {
      const match = await matchVenue(paper.title);
      checked[paper.id] = today;
      looked++;
      // Only an accepted match gets a decision: the evidence view reads any other decision as PEER.
      if (match && (match.accepted || match.venue)) {
        rows.push({
          paperId: paper.id,
          orVenue: match.venue ?? null,
          orDecision: match.accepted ? (match.venueid ?? "Accepted") : null,
        });
      }
    }
  } catch (e) {
    if (e instanceof SourceUnavailable) error = errorMessage(e);
    else failure = e;
  }
  // Matches found before an error are written first; the cursor follows, so a failed insert
  // leaves those papers due again instead of marking them checked.
  try {
    written = await insertSignals(rows);
    await db
      .update(sources)
      .set({ cursor: { ...(row?.cursor ?? {}), checked } })
      .where(eq(sources.kind, "openreview"));
  } catch (e) {
    if (failure === undefined) failure = e;
    else console.warn(`openreview enrich: write after an error also failed: ${errorMessage(e)}`);
  }
  if (failure !== undefined) return { status: "FAILED", items: written, error: errorMessage(failure) };
  return { status: error ? "PARTIAL" : "OK", items: written, error: error ?? (looked ? undefined : "no papers due") };
}

// A failed lookup writes nothing, so earlier S2 values on the latest snapshot are kept.
async function enrichS2(): Promise<SourceOutcome> {
  const rows = await db.execute<{ id: string; arxiv_id: string }>(sql`
    select p.id, p.arxiv_id from research_signal.papers p
    where p.status = 'FINALIST' and p.arxiv_id is not null and ${recent}`);
  if (rows.length === 0) return { status: "OK", items: 0 };
  const byArxiv = new Map(rows.map((r) => [r.arxiv_id, r.id]));
  const found = await batchLookup([...byArxiv.keys()]);
  const written = await insertSignals(
    found.flatMap((paper) => {
      const paperId = byArxiv.get(paper.arxivId);
      if (!paperId) return [];
      return [
        {
          paperId,
          s2Citations: paper.citationCount,
          buildsOn: paper.buildsOn.length ? paper.buildsOn : null,
          venue: paper.venue ?? paper.publicationVenue,
        },
      ];
    }),
  );
  // batchLookup stops at the first failing chunk and returns the earlier chunks with `error` set.
  if (found.error) return { status: "PARTIAL", items: written, error: found.error };
  return { status: "OK", items: written };
}

export async function runEnrich(): Promise<EnrichResult> {
  const enabled = new Map((await getEnabledSources()).map((s) => [s.kind, s]));
  const hf = enabled.has("hf") ? await tracked("hf", enrichHf) : skipped("hf disabled");
  const openreview = enabled.has("openreview")
    ? await tracked("openreview", () => enrichOpenReview(enabled.get("openreview")?.params))
    : skipped("openreview disabled");
  const s2 = enabled.has("s2") ? await tracked("s2", enrichS2) : skipped("s2 disabled");
  const { ranked, promoted } = await rankAll();
  return { hf, openreview, s2, ranked, promoted };
}
