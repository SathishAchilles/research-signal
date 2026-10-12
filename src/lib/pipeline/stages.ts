import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sources } from "@/db/schema";
import { weeklyRetryStage, weeklyStage } from "@/lib/brief/weekly";
import { LlmCreditsExhausted } from "@/lib/llm/call";
import { type ArxivItem, DEFAULT_CATEGORIES, fetchBackstop, fetchRssDelta, upsertArxivItems } from "@/lib/sources/arxiv";
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
  enrich: () => runEnrich(),
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
  while (Date.now() - started < budgetMs) {
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
        let etag: string | undefined;
        try {
          const rss = await fetchRssDelta(categories, row?.etag ?? undefined, wait);
          items.push(...rss.items);
          etag = rss.etag;
        } catch (error) {
          errors.push(`rss: ${errorMessage(error)}`);
        }
        try {
          items.push(...(await fetchBackstop(categories, from, to, wait)));
        } catch (error) {
          errors.push(`backstop: ${errorMessage(error)}`);
        }
        return { items, errors, etag };
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
    const status: RunStatus = fetched.errors.length === 0 ? "OK" : fetched.errors.length === 1 ? "PARTIAL" : "FAILED";
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
// feeds the rising lane. Papers Hugging Face does not list get no snapshot.
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
    const outcome: StageOutcome = { status: "OK", items: written };
    await finishRun(runId, outcome.status, outcome.items);
    return outcome;
  } catch (error) {
    await finishRun(runId, "FAILED", 0, errorMessage(error));
    return { status: "FAILED", items: 0, error: errorMessage(error) };
  }
}

export async function heartbeat(): Promise<StageOutcome> {
  if (!(await isSchedulerStale())) return { status: "SKIPPED", items: 0 };
  const outcome = await drain();
  return { ...outcome, error: ["scheduler stale", outcome.error].filter(Boolean).join("; ") };
}

const notImplemented = async (): Promise<StageOutcome> => ({
  status: "SKIPPED",
  items: 0,
  error: "stage not implemented yet",
});

export const stageHandlers: Record<StageName, () => Promise<StageOutcome>> = {
  ingest,
  drain: () => drain(),
  hf_refresh: hfRefresh,
  weekly: () => weeklyStage(),
  weekly_retry: () => weeklyRetryStage(),
  retention: notImplemented,
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
