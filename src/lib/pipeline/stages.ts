import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sources } from "@/db/schema";
import { weeklyRetryStage, weeklyStage } from "@/lib/brief/weekly";
import { LlmCreditsExhausted } from "@/lib/llm/call";
import { type ArxivItem, DEFAULT_CATEGORIES, fetchBackstop, fetchRssDelta, upsertArxivItems } from "@/lib/sources/arxiv";
import { fetchArxivFigures, saveFigures } from "@/lib/sources/fulltext";
import { fetchDaily, fetchDetail, writeHfSignals } from "@/lib/sources/hf";
import { withArxivLease } from "@/lib/sources/lease";
import { getEnabledSources, getSourceSecret } from "@/lib/sources/registry";
import { type RunStatus, finishRun, startRun } from "@/lib/sources/runs";
import { errorMessage } from "@/lib/sources/types";
import { runEmbed1, runEmbed2 } from "./embed";
import { runEnrich } from "./enrich";
import { type JobStage, claimNext, complete, enqueue, fail, isSchedulerStale, requeueExpired } from "./jobs";
import { runScore } from "./score";

export const STAGE_NAMES = ["ingest", "drain", "hf_refresh", "weekly", "weekly_retry", "retention", "heartbeat"] as const;
export type StageName = (typeof STAGE_NAMES)[number];
export type StageOutcome = { status: RunStatus; items: number; error?: string };

export const DRAIN_BUDGET_MS = 240_000;
// A job can run for minutes, so drain claims a new one only while this much of the budget is left.
export const DRAIN_MIN_REMAINING_MS = 90_000;
const LEASE_WAIT_MS = 60_000;
const DAY_MS = 86_400_000;

export function isStageName(name: string): name is StageName {
  return (STAGE_NAMES as readonly string[]).includes(name);
}

type JobRunner = (payload: Record<string, unknown>) => Promise<unknown>;

// Queue stages drain can run. Stages without a runner stay PENDING until one is registered here.
export const jobRunners: Partial<Record<JobStage, JobRunner>> = {
  embed1: (payload) =>
    runEmbed1(Array.isArray(payload.paperIds) ? payload.paperIds.map(String) : undefined),
  embed2: () => runEmbed2(),
  score: () => runScore(),
  enrich: async () => {
    await runEnrich();
    await enqueue("figures");
  },
  figures: () => runFigures(),
  hf_refresh: () => hfRefresh(),
};

function failureReason(error: unknown): string {
  return error instanceof LlmCreditsExhausted ? "llm_credits_exhausted" : errorMessage(error);
}

export async function drain(budgetMs = DRAIN_BUDGET_MS): Promise<StageOutcome> {
  const started = Date.now();
  const runnable = Object.keys(jobRunners) as JobStage[];
  await requeueExpired();
  let done = 0;
  const errors: string[] = [];
  while (budgetMs - (Date.now() - started) >= DRAIN_MIN_REMAINING_MS) {
    const job = await claimNext(runnable);
    if (!job) break;
    try {
      await jobRunners[job.stage]!(job.payload);
      await complete(job.id);
      done++;
    } catch (error) {
      await fail(job.id, error);
      errors.push(`${job.stage}#${job.id}: ${failureReason(error)}`);
      if (error instanceof LlmCreditsExhausted) break;
    }
  }
  const status: RunStatus = errors.length === 0 ? "OK" : done > 0 ? "PARTIAL" : "FAILED";
  return { status, items: done, error: errors.length ? errors.join("; ") : undefined };
}

function utcDate(offsetDays: number, now = new Date()): string {
  return new Date(now.getTime() - offsetDays * DAY_MS).toISOString().slice(0, 10);
}

async function ingestArxiv(params: { categories?: string[]; backstopDays?: number }): Promise<StageOutcome> {
  const runId = await startRun("arxiv", "ingest");
  try {
    const categories = params.categories ?? DEFAULT_CATEGORIES;
    const to = new Date();
    const from = new Date(to.getTime() - ((params.backstopDays ?? 4) - 1) * DAY_MS);
    const [row] = await db.select({ etag: sources.etag }).from(sources).where(eq(sources.kind, "arxiv"));

    const fetched = await withArxivLease(
      "ingest",
      async (wait) => {
        const items: ArxivItem[] = [];
        const errors: string[] = [];
        let failedFeeds = 0;
        let etag: string | undefined;
        try {
          const rss = await fetchRssDelta(categories, row?.etag ?? undefined, wait);
          items.push(...rss.items);
          etag = rss.etag;
        } catch (error) {
          errors.push(`rss: ${errorMessage(error)}`);
          failedFeeds++;
        }
        try {
          const backstop = await fetchBackstop(categories, from, to, wait);
          items.push(...backstop);
          if (backstop.incomplete) errors.push(`backstop incomplete: ${backstop.incomplete}`);
        } catch (error) {
          errors.push(`backstop: ${errorMessage(error)}`);
          failedFeeds++;
        }
        return { items, errors, failedFeeds, etag };
      },
      { maxWaitMs: LEASE_WAIT_MS },
    );
    if (fetched === "busy") {
      const outcome: StageOutcome = { status: "SKIPPED", items: 0, error: "arXiv lease busy" };
      await finishRun(runId, outcome.status, outcome.items, outcome.error);
      return outcome;
    }

    const inserted = await upsertArxivItems(fetched.items);
    if (fetched.etag && fetched.etag !== row?.etag) {
      await db.update(sources).set({ etag: fetched.etag }).where(eq(sources.kind, "arxiv"));
    }
    // FAILED only when both feeds failed outright; an incomplete backstop still delivered its pages.
    const status: RunStatus = fetched.errors.length === 0 ? "OK" : fetched.failedFeeds < 2 ? "PARTIAL" : "FAILED";
    const error = fetched.errors.length ? fetched.errors.join("; ") : undefined;
    await finishRun(runId, status, inserted, error);
    return { status, items: inserted, error };
  } catch (error) {
    await finishRun(runId, "FAILED", 0, errorMessage(error));
    return { status: "FAILED", items: 0, error: errorMessage(error) };
  }
}

async function ingestHf(params: { dailyDays?: number }): Promise<StageOutcome> {
  const runId = await startRun("hf", "ingest");
  try {
    const dates = Array.from({ length: params.dailyDays ?? 3 }, (_, i) => utcDate(i));
    const daily = await fetchDaily(dates, await getSourceSecret("hf"));
    const written = await writeHfSignals(daily);
    await finishRun(runId, "OK", written);
    return { status: "OK", items: written };
  } catch (error) {
    await finishRun(runId, "FAILED", 0, errorMessage(error));
    return { status: "FAILED", items: 0, error: errorMessage(error) };
  }
}

// arXiv first, so HF signals can attach to papers inserted in the same run.
export async function ingest(): Promise<StageOutcome> {
  const enabled = await getEnabledSources();
  const arxiv = enabled.find((s) => s.kind === "arxiv");
  const hf = enabled.find((s) => s.kind === "hf");
  const outcomes: StageOutcome[] = [];
  if (arxiv) outcomes.push(await ingestArxiv(arxiv.params as { categories?: string[]; backstopDays?: number }));
  if (hf) outcomes.push(await ingestHf(hf.params as { dailyDays?: number }));
  await enqueue("embed1");

  const failed = outcomes.filter((o) => o.status !== "OK");
  const status: RunStatus =
    outcomes.length === 0 ? "SKIPPED" : failed.length === 0 ? "OK" : failed.length < outcomes.length ? "PARTIAL" : "FAILED";
  const errors = failed.map((o) => o.error).filter(Boolean);
  return { status, items: outcomes[0]?.items ?? 0, error: errors.length ? errors.join("; ") : undefined };
}

const HF_REFRESH_DAYS = 10;

// New HF snapshots for papers shortlisted (or better, including SENT) in the last 10 days, which
// feeds the rising lane. Papers Hugging Face does not list get no snapshot. fetchDetail paces the
// requests and retries a 429 once; the run is PARTIAL when some requests still failed (their papers
// get no snapshot this time) and FAILED only when all of them did.
export async function hfRefresh(): Promise<StageOutcome> {
  const runId = await startRun("hf", "hf_refresh");
  try {
    const rows = await db.execute<{ arxiv_id: string }>(sql`
      select p.arxiv_id from research_signal.papers p
      where p.arxiv_id is not null
        and p.status in ('SHORTLISTED', 'SCORED', 'FINALIST', 'SENT')
        and coalesce(p.announced_at, p.submitted_at, p.created_at) >= now() - make_interval(days => ${HF_REFRESH_DAYS})`);
    const details = await fetchDetail(rows.map((r) => r.arxiv_id), await getSourceSecret("hf"));
    const written = await writeHfSignals(details);
    const outcome: StageOutcome =
      details.failed > 0
        ? { status: "PARTIAL", items: written, error: `${details.failed} of ${rows.length} HF detail requests failed` }
        : { status: "OK", items: written };
    await finishRun(runId, outcome.status, outcome.items, outcome.error);
    return outcome;
  } catch (error) {
    await finishRun(runId, "FAILED", 0, errorMessage(error));
    return { status: "FAILED", items: 0, error: errorMessage(error) };
  }
}

export const FIGURES_PER_RUN = 30;

// Fetches arXiv HTML for FINALIST papers without `figures` (newest first, at most 30 per run) under
// one arXiv lease at 3.1 s spacing, and stores their figures. A paper with no HTML version gets an
// empty list, which records the attempt; a network error leaves it for the next run. A full batch
// queues another run. Throws when the lease stays busy or every fetch failed, so the job is retried.
// A 429 from arXiv pauses 30 s and retries that paper once per run; a second 429 stops the run and
// skips the full-batch re-queue. If nothing was saved the run throws, so the queue retries it after
// its 5-minute backoff; otherwise the unfetched papers (still `figures` NULL) wait for a later run.
// fetchArxivFigures surfaces only the status in its error, so no Retry-After value reaches this loop.
export async function runFigures(limit = FIGURES_PER_RUN): Promise<StageOutcome> {
  const RATE_LIMIT_PAUSE_MS = 30_000;
  const isRateLimited = (error: unknown) => /^HTTP 429\b/.test(errorMessage(error));
  const runId = await startRun("arxiv", "figures");
  try {
    const rows = await db.execute<{ arxiv_id: string }>(sql`
      select p.arxiv_id from research_signal.papers p
      where p.status = 'FINALIST' and p.arxiv_id is not null and p.figures is null
      order by coalesce(p.announced_at, p.submitted_at, p.created_at) desc
      limit ${limit}`);
    const result = await withArxivLease(
      "figures",
      async (wait) => {
        let saved = 0;
        let retried = false;
        let rateLimited = false;
        const errors: string[] = [];
        for (const [index, { arxiv_id: arxivId }] of rows.entries()) {
          while (true) {
            await wait();
            try {
              await saveFigures(arxivId, await fetchArxivFigures(arxivId));
              saved++;
            } catch (error) {
              if (isRateLimited(error) && !retried) {
                retried = true;
                await new Promise<void>((resolve) => setTimeout(resolve, RATE_LIMIT_PAUSE_MS));
                continue;
              }
              errors.push(`${arxivId}: ${errorMessage(error)}`);
              if (isRateLimited(error)) rateLimited = true;
            }
            break;
          }
          if (rateLimited) {
            errors.push(`arXiv rate limited; stopped with ${rows.length - index - 1} papers left for the next run`);
            break;
          }
        }
        return { saved, errors, rateLimited };
      },
      { maxWaitMs: LEASE_WAIT_MS },
    );
    if (result === "busy") throw new Error("arXiv lease busy");
    if (result.saved === 0 && result.errors.length > 0) throw new Error(result.errors.join("; "));
    if (rows.length === limit && !result.rateLimited) await enqueue("figures");
    const outcome: StageOutcome =
      result.errors.length === 0
        ? { status: "OK", items: result.saved }
        : { status: "PARTIAL", items: result.saved, error: result.errors.join("; ") };
    await finishRun(runId, outcome.status, outcome.items, outcome.error);
    return outcome;
  } catch (error) {
    await finishRun(runId, "FAILED", 0, errorMessage(error));
    throw error;
  }
}

export async function heartbeat(): Promise<StageOutcome> {
  if (!(await isSchedulerStale())) return { status: "SKIPPED", items: 0 };
  const outcome = await drain();
  return { ...outcome, error: ["scheduler stale", outcome.error].filter(Boolean).join("; ") };
}

export const RETENTION_PAPER_WEEKS = 12;
export const RETENTION_SIGNAL_WEEKS = 26;

// D16 retention, in one transaction:
// - DROPPED and PREFILTERED (never shortlisted) papers go, with their search_docs rows, once both the
//   paper and our copy of it are older than 12 weeks. The created_at guard keeps an old paper that was
//   ingested recently (an HF listing, say), which would otherwise be deleted and re-ingested. NEW papers
//   are still in the queue and stay. A paper in a brief or with a user action is kept, because briefs
//   and actions are history. Cascades remove its paper_domain and signals rows.
// - signals snapshots older than 26 weeks go, except the latest one per paper.
// The counts go into this stage's source_runs row: items is the total, error carries the breakdown.
export async function retention(): Promise<StageOutcome> {
  const counts = await db.transaction(async (tx) => {
    const [docs] = await tx.execute<{ papers: number; search_docs: number }>(sql`
      with doomed as (
        select p.id from research_signal.papers p
        where p.status in ('DROPPED', 'PREFILTERED')
          and p.created_at < now() - make_interval(weeks => ${RETENTION_PAPER_WEEKS})
          and coalesce(p.announced_at, p.submitted_at, p.created_at) < now() - make_interval(weeks => ${RETENTION_PAPER_WEEKS})
          and not exists (select 1 from research_signal.brief_items b where b.paper_id = p.id)
          and not exists (select 1 from research_signal.actions a where a.paper_id = p.id)
      ),
      gone_docs as (
        delete from research_signal.search_docs d using doomed where d.paper_id = doomed.id returning 1
      ),
      gone_papers as (
        delete from research_signal.papers p using doomed where p.id = doomed.id returning 1
      )
      select (select count(*) from gone_papers)::int as papers, (select count(*) from gone_docs)::int as search_docs`);
    const [signalRows] = await tx.execute<{ signals: number }>(sql`
      with gone as (
        delete from research_signal.signals s
        where s.captured_at < now() - make_interval(weeks => ${RETENTION_SIGNAL_WEEKS})
          and exists (
            select 1 from research_signal.signals newer
            where newer.paper_id = s.paper_id
              and (newer.captured_at > s.captured_at or (newer.captured_at = s.captured_at and newer.id > s.id))
          )
        returning 1
      )
      select count(*)::int as signals from gone`);
    return { papers: docs.papers, searchDocs: docs.search_docs, signals: signalRows.signals };
  });
  return {
    status: "OK",
    items: counts.papers + counts.searchDocs + counts.signals,
    error: `deleted papers=${counts.papers} search_docs=${counts.searchDocs} signals=${counts.signals}`,
  };
}

export const stageHandlers: Record<StageName, () => Promise<StageOutcome>> = {
  ingest,
  drain: () => drain(),
  hf_refresh: hfRefresh,
  weekly: () => weeklyStage(),
  weekly_retry: () => weeklyRetryStage(),
  retention,
  heartbeat,
};

// Records one source_runs row for the stage itself; source-specific rows are written by the handlers.
export async function runStage(name: StageName): Promise<StageOutcome> {
  const runId = await startRun(null, name);
  try {
    const outcome = await stageHandlers[name]();
    await finishRun(runId, outcome.status, outcome.items, outcome.error);
    return outcome;
  } catch (error) {
    const outcome: StageOutcome = { status: "FAILED", items: 0, error: failureReason(error) };
    await finishRun(runId, outcome.status, outcome.items, outcome.error);
    return outcome;
  }
}
