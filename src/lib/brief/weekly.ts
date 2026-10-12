import { and, eq, inArray, sql } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@/db/client";
import { appSettings, briefItems, briefs, papers, sourceRuns } from "@/db/schema";
import { env } from "@/lib/env";
import { recomputeCentroids } from "@/lib/pipeline/centroids";
import { upsertSearchDoc } from "@/lib/search/index";
import { insertSignals } from "@/lib/sources/hf";
import { type RunStatus, finishRun, startRun } from "@/lib/sources/runs";
import { batchLookup } from "@/lib/sources/s2";
import { errorMessage } from "@/lib/sources/types";
import { syncVenues } from "@/lib/sources/venues";
import { composeBrief } from "./compose";
import { renderEmail } from "./email";
import { finalRerank } from "./rerank";
import { isEmptySelection, selectBrief } from "./select";
import { fillTokens } from "./tokens";
import type { BriefDoc, BriefProse, BriefSelection, Evidence, RerankJudgement } from "./types";
import { type BriefWindow, briefWindow, dayMonth, nextSendTime, zonedParts } from "./window";

export type WeeklyOutcome = { status: RunStatus; items: number; error?: string };

export type BuiltBrief = {
  briefId: string;
  isoWeek: string;
  empty: boolean;
  cards: number;
  bytes: number;
  compactOnWeb: boolean;
  proseSource: BriefDoc["proseSource"];
  proseErrors: string[];
  html: string;
  doc: BriefDoc | null;
};

function fillProse(prose: BriefProse, selection: BriefSelection): BriefProse {
  const evidence: Record<string, Evidence> = Object.fromEntries(
    Object.values(selection.cards).map((c) => [c.cardId, c.evidence]),
  );
  const fill = (text: string) => fillTokens(text, evidence);
  return {
    weekLine: fill(prose.weekLine),
    top3: prose.top3.map((t) => ({ ...t, pointer: fill(t.pointer) })),
    domains: prose.domains.map((d) => ({
      ...d,
      situation: fill(d.situation),
      complication: fill(d.complication),
      implication: fill(d.implication),
      cards: d.cards.map((c) => ({
        ...c,
        headline: fill(c.headline),
        lede: c.lede === undefined ? undefined : fill(c.lede),
        clientAngle: fill(c.clientAngle),
        verdictReason: fill(c.verdictReason),
      })),
    })),
    rising: prose.rising.map((r) => ({ ...r, line: fill(r.line) })),
  };
}

async function upsertBriefRow(window: BriefWindow): Promise<string> {
  const [row] = await db
    .insert(briefs)
    .values({ isoWeek: window.isoWeek, windowStart: window.start, windowEnd: window.end, status: "DRAFT" })
    .onConflictDoUpdate({ target: briefs.isoWeek, set: { windowStart: window.start, windowEnd: window.end } })
    .returning({ id: briefs.id });
  return row.id;
}

function searchBody(doc: BriefDoc): string {
  const { prose, selection } = doc;
  const lines = [prose.weekLine];
  for (const d of selection.domains) {
    const p = prose.domains.find((x) => x.domainId === d.domainId);
    lines.push(`${d.name}: ${[p?.situation, p?.complication, p?.implication].filter(Boolean).join(" ")}`);
    for (const id of [d.hero, ...d.standard, ...d.compact].filter((x): x is string => Boolean(x))) {
      lines.push(`- ${selection.cards[id].title}`);
    }
  }
  return lines.join("\n");
}

function storedRerank(json: unknown): RerankJudgement[] | undefined {
  const rerank = (json as Partial<BriefDoc> | null)?.rerank;
  // An empty array means no rerank ran (no FINALISTs, or a failed judge); never reuse it.
  return Array.isArray(rerank) && rerank.length > 0 ? rerank : undefined;
}

// Selection, optional rerank, prose, tokens and HTML for one window, stored as a READY brief with its
// brief_items. It never sends and never marks papers SENT. Rerank judgements already stored for the
// week are reused (no second LLM call); only `persistRerank` writes them to paper_domain.
export async function buildBrief(
  window: BriefWindow,
  options: { rerank?: boolean; overwriteDelivered?: boolean; persistRerank?: boolean } = {},
): Promise<BuiltBrief> {
  const [existing] = await db
    .select({ status: briefs.status, json: briefs.json })
    .from(briefs)
    .where(eq(briefs.isoWeek, window.isoWeek));
  if (!options.overwriteDelivered && existing && (existing.status === "SCHEDULED" || existing.status === "SENT")) {
    throw new Error(`brief ${window.isoWeek} is already ${existing.status}; not rebuilding it`);
  }
  const previousRerank = storedRerank(existing?.json);
  let selection = await selectBrief(window);
  let rerank = previousRerank;
  if (options.rerank !== false && !isEmptySelection(selection)) {
    const result = await finalRerank(selection, { persist: options.persistRerank, reuse: previousRerank });
    rerank = result.judgements.length > 0 ? result.judgements : undefined;
    if (result.changes.length > 0) selection = await selectBrief(window, result.overrides);
  }
  const briefId = await upsertBriefRow(window);

  if (isEmptySelection(selection)) {
    await db.update(briefs).set({ status: "FAILED", json: null, html: null, htmlBytes: null }).where(eq(briefs.id, briefId));
    await db.delete(briefItems).where(eq(briefItems.briefId, briefId));
    await db.insert(sourceRuns).values({
      sourceKind: "brief",
      stage: "weekly",
      finishedAt: new Date(),
      status: "FAILED",
      items: 0,
      error: `empty brief for ${window.isoWeek}: no scored papers in ${window.label}`,
    });
    return { briefId, isoWeek: window.isoWeek, empty: true, cards: 0, bytes: 0, compactOnWeb: false, proseSource: "fallback", proseErrors: [], html: "", doc: null };
  }

  const composed = await composeBrief(selection);
  const doc: BriefDoc = {
    version: 1,
    briefId,
    generatedAt: new Date().toISOString(),
    proseSource: composed.source,
    selection,
    prose: fillProse(composed.prose, selection),
    ...(rerank && rerank.length > 0 ? { rerank } : {}),
  };
  const { html, bytes, compactOnWeb } = renderEmail(doc);

  const items = Object.values(selection.cards).flatMap((card) => {
    const rank = (list: string[]) => list.indexOf(card.cardId) + 1;
    const domain = selection.domains.find((d) => d.domainId === card.domainId);
    const own = {
      briefId,
      paperId: card.paperId,
      domainId: card.domainId,
      tier: card.tier,
      rank: card.tier === "RISING" ? rank(selection.rising) : card.tier === "HERO" ? 1 : rank(card.tier === "STANDARD" ? (domain?.standard ?? []) : (domain?.compact ?? [])),
    };
    return card.inTop3
      ? [own, { briefId, paperId: card.paperId, domainId: card.domainId, tier: "TOP3" as const, rank: rank(selection.top3) }]
      : [own];
  });
  await db.transaction(async (tx) => {
    await tx.delete(briefItems).where(eq(briefItems.briefId, briefId));
    await tx.insert(briefItems).values(items);
    await tx
      .update(briefs)
      .set({ status: "READY", json: doc, html, htmlBytes: bytes })
      .where(eq(briefs.id, briefId));
  });

  await upsertSearchDoc({
    entityType: "brief",
    entityId: briefId,
    title: `Weekly brief ${window.isoWeek}: ${doc.prose.weekLine}`,
    body: searchBody(doc),
    facets: {
      domainIds: selection.domains.filter((d) => !d.quiet).map((d) => d.domainId),
      source: "brief",
      publishedAt: window.end,
    },
  });

  return {
    briefId,
    isoWeek: window.isoWeek,
    empty: false,
    cards: Object.keys(selection.cards).length,
    bytes,
    compactOnWeb,
    proseSource: composed.source,
    proseErrors: composed.errors,
    html,
    doc,
  };
}

async function s2Refresh(window: BriefWindow): Promise<void> {
  const runId = await startRun("s2", "weekly");
  try {
    const rows = await db.execute<{ id: string; arxiv_id: string }>(sql`
      select p.id, p.arxiv_id from research_signal.papers p
      where p.status = 'FINALIST' and p.arxiv_id is not null
        and coalesce(p.announced_at, p.submitted_at, p.created_at) >= ${window.start.toISOString()}
        and coalesce(p.announced_at, p.submitted_at, p.created_at) < ${window.end.toISOString()}`);
    const byArxiv = new Map(rows.map((r) => [r.arxiv_id, r.id]));
    const found = byArxiv.size ? await batchLookup([...byArxiv.keys()]) : [];
    const written = await insertSignals(
      found.flatMap((paper) => {
        const paperId = byArxiv.get(paper.arxivId);
        return paperId
          ? [{ paperId, s2Citations: paper.citationCount, buildsOn: paper.buildsOn.length ? paper.buildsOn : null, venue: paper.venue ?? paper.publicationVenue }]
          : [];
      }),
    );
    await finishRun(runId, "OK", written);
  } catch (error) {
    await finishRun(runId, "PARTIAL", 0, errorMessage(error));
  }
}

// scheduledFor is null when the window's Monday slot has passed and the brief goes out at once.
type SendResult = { resendId: string | null; scheduledFor: Date | null; dryRun: boolean };

type Previous = { resendId: string | null; status: string } | undefined;

async function sendBrief(built: BuiltBrief, now: Date, dryRun: boolean, previous: Previous): Promise<SendResult> {
  const [settings] = await db
    .select({ recipients: appSettings.recipients, timezone: appSettings.timezone, sendLocalTime: appSettings.sendLocalTime })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  if (!settings || settings.recipients.length === 0) throw new Error("no recipients configured in app_settings");
  const scheduledFor = nextSendTime(briefWindow(now), now, settings.timezone, settings.sendLocalTime);
  const sendDay = zonedParts(scheduledFor ?? now, settings.timezone);
  const subject = `research-signal, ${dayMonth(new Date(Date.UTC(sendDay.y, sendDay.m - 1, sendDay.d)))}: ${built.doc?.prose.weekLine ?? ""}`;

  if (dryRun) {
    console.log(
      `DRY_RUN: would send brief ${built.isoWeek} to ${settings.recipients.join(", ")} from RESEND_FROM, ` +
        `subject ${subject.length} chars, html ${built.bytes} bytes, ` +
        (scheduledFor ? `scheduledAt ${scheduledFor.toISOString()}` : "scheduledAt omitted (send now)"),
    );
    return { resendId: null, scheduledFor, dryRun: true };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  if (previous?.status === "SCHEDULED" && previous.resendId) {
    const cancelled = await resend.emails.cancel(previous.resendId);
    if (cancelled.error) console.warn(`could not cancel earlier scheduled email: ${cancelled.error.message}`);
  }
  const { data, error } = await resend.emails.send({
    from: env.RESEND_FROM,
    to: settings.recipients,
    subject,
    html: built.html,
    ...(scheduledFor ? { scheduledAt: scheduledFor.toISOString() } : {}),
  });
  if (error || !data) throw new Error(`Resend send failed: ${error?.message ?? "no id returned"}`);
  return { resendId: data.id, scheduledFor, dryRun: false };
}

// Sunday job: venue diffs, best-effort S2 refresh, centroids, then build, send (scheduled for Monday)
// and mark the brief's papers SENT. DRY_RUN=1 skips the Resend call and leaves the brief READY.
export async function runWeekly(
  options: { now?: Date; dryRun?: boolean; rerank?: boolean } = {},
): Promise<WeeklyOutcome & { briefId?: string; isoWeek: string; dryRun: boolean }> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? process.env.DRY_RUN === "1";
  const window = briefWindow(now);
  const notes: string[] = [];

  const venues = await syncVenues("weekly").catch((error: unknown) => {
    notes.push(`venues: ${errorMessage(error)}`);
    return [];
  });
  for (const v of venues) if (v.status !== "OK") notes.push(`${v.kind}: ${v.error ?? v.status}`);
  await s2Refresh(window);
  await recomputeCentroids();

  const [previous] = await db
    .select({ resendId: briefs.resendId, status: briefs.status })
    .from(briefs)
    .where(eq(briefs.isoWeek, window.isoWeek));
  const built = await buildBrief(window, { rerank: options.rerank, overwriteDelivered: true, persistRerank: !dryRun });
  if (built.empty) {
    return { status: "FAILED", items: 0, error: `empty brief for ${window.isoWeek}; not sent`, briefId: built.briefId, isoWeek: window.isoWeek, dryRun };
  }

  const sent = await sendBrief(built, now, dryRun, previous);
  if (sent.dryRun && (previous?.status === "SCHEDULED" || previous?.status === "SENT")) {
    await db.update(briefs).set({ status: previous.status }).where(eq(briefs.id, built.briefId));
  }
  if (!sent.dryRun) {
    const paperIds = [...new Set(Object.values(built.doc!.selection.cards).map((c) => c.paperId))];
    await db.transaction(async (tx) => {
      await tx
        .update(briefs)
        .set(
          sent.scheduledFor
            ? { status: "SCHEDULED", resendId: sent.resendId, scheduledFor: sent.scheduledFor, sentAt: null }
            : { status: "SENT", resendId: sent.resendId, scheduledFor: null, sentAt: now },
        )
        .where(eq(briefs.id, built.briefId));
      await tx
        .update(papers)
        .set({ status: "SENT" })
        .where(and(inArray(papers.id, paperIds), inArray(papers.status, ["SCORED", "FINALIST"])));
    });
  }
  notes.push(`prose ${built.proseSource}`, `${built.bytes} bytes`, sent.dryRun ? "dry run: not sent" : sent.scheduledFor ? `scheduled ${sent.scheduledFor.toISOString()}` : "sent at once");
  return { status: "OK", items: built.cards, error: notes.join("; "), briefId: built.briefId, isoWeek: window.isoWeek, dryRun };
}

export async function weeklyStage(): Promise<WeeklyOutcome> {
  const { status, items, error } = await runWeekly();
  return { status, items, error };
}

// Sunday retry: does nothing once this week's brief is SCHEDULED or SENT.
export async function weeklyRetryStage(now = new Date()): Promise<WeeklyOutcome> {
  const { isoWeek } = briefWindow(now);
  const [row] = await db.select({ status: briefs.status }).from(briefs).where(eq(briefs.isoWeek, isoWeek));
  if (row && (row.status === "SCHEDULED" || row.status === "SENT")) {
    return { status: "SKIPPED", items: 0, error: `brief ${isoWeek} already ${row.status}` };
  }
  return weeklyStage();
}
