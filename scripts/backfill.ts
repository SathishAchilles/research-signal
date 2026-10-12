// Loads the last N weeks of arXiv, runs the pipeline over them and composes a READY preview brief
// for the latest complete week without sending it.
// Usage: npm run backfill -- --weeks 2 [--budget 0.30] [--no-brief]
import { parseArgs } from "node:util";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sources } from "@/db/schema";
import { buildBrief } from "@/lib/brief/weekly";
import { briefWindow } from "@/lib/brief/window";
import { runEmbed1, runEmbed2 } from "@/lib/pipeline/embed";
import { runEnrich } from "@/lib/pipeline/enrich";
import { type JobStage, claimNext, complete } from "@/lib/pipeline/jobs";
import { runScore } from "@/lib/pipeline/score";
import { runFigures } from "@/lib/pipeline/stages";
import { DEFAULT_CATEGORIES, fetchBackstopPage, upsertArxivItems } from "@/lib/sources/arxiv";
import { withArxivLease } from "@/lib/sources/lease";

const PAGE_SIZE = 2000;
// The arXiv API serves at most this many results for one query.
const API_RESULT_CAP = 30_000;
const DAY_MS = 86_400_000;
const SCORE_CHUNK = 50;
// Held back from the scoring budget for the final rerank and compose calls.
const BRIEF_RESERVE_USD = 0.05;
const FALLBACK_COST_PER_PAPER = 0.0015;

const { values } = parseArgs({
  options: {
    weeks: { type: "string", default: "2" },
    budget: { type: "string", default: "0.30" },
    "no-brief": { type: "boolean", default: false },
  },
});
const weeks = Number(values.weeks);
const budget = Number(values.budget);
if (!Number.isInteger(weeks) || weeks < 1 || weeks > 8) throw new Error("--weeks must be an integer from 1 to 8");
if (!Number.isFinite(budget) || budget <= 0) throw new Error("--budget must be a positive number of USD");

const runStart = new Date();
const timings: [string, number][] = [];

async function stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await fn();
  const ms = Date.now() - started;
  timings.push([name, ms]);
  console.log(`[${name}] ${(ms / 1000).toFixed(1)} s`);
  return result;
}

async function spentSinceStart(): Promise<number> {
  const [row] = await db.execute<{ usd: number | null }>(sql`
    select sum(cost_usd)::float8 as usd from research_signal.llm_calls where created_at >= ${runStart.toISOString()}`);
  return Number(row?.usd ?? 0);
}

// Marks queued jobs for a stage DONE once this script has done that stage's work itself.
async function settleJobs(stage: JobStage): Promise<number> {
  let n = 0;
  for (let job = await claimNext([stage]); job; job = await claimNext([stage])) {
    await complete(job.id);
    n++;
  }
  return n;
}

async function fetchArxiv(): Promise<{ fetched: number; inserted: number; pages: number }> {
  const [row] = await db.select({ params: sources.params }).from(sources).where(eq(sources.kind, "arxiv"));
  const categories = (row?.params as { categories?: string[] } | undefined)?.categories ?? DEFAULT_CATEGORIES;
  const to = new Date();
  const from = new Date(to.getTime() - (weeks * 7 - 1) * DAY_MS);
  const result = await withArxivLease(
    "backfill",
    async (wait) => {
      let fetched = 0;
      let inserted = 0;
      let pages = 0;
      let total = 0;
      // Like fetchBackstop: an empty page is retried once, and a later page that fails or stays empty
      // stops the fetch with a warning; the pages already upserted are kept.
      for (let start = 0; ; start += PAGE_SIZE) {
        let page: Awaited<ReturnType<typeof fetchBackstopPage>>;
        try {
          page = await fetchBackstopPage(categories, from, to, start, wait);
          if (page.items.length === 0 && (start > 0 || page.totalResults > 0)) {
            page = await fetchBackstopPage(categories, from, to, start, wait);
          }
        } catch (error) {
          if (start === 0) throw error;
          console.warn(`  page at ${start} failed: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
        const { items, totalResults } = page;
        if (start === 0) total = totalResults;
        pages++;
        fetched += items.length;
        inserted += await upsertArxivItems(items);
        console.log(`  page ${pages} (start ${start}): ${items.length} items, ${inserted} new so far`);
        if (items.length === 0 || start + PAGE_SIZE >= total) break;
        if (start + PAGE_SIZE >= API_RESULT_CAP) {
          console.warn(`  arXiv serves at most ${API_RESULT_CAP} results; ${total - API_RESULT_CAP} older ones not fetched`);
          break;
        }
      }
      const expected = Math.min(total, API_RESULT_CAP);
      if (fetched < expected) console.warn(`  arXiv backstop incomplete: fetched ${fetched} of ${expected} results`);
      return { fetched, inserted, pages };
    },
    { maxWaitMs: 120_000 },
  );
  if (result === "busy") throw new Error("arXiv lease busy for 120 s; try again");
  return result;
}

// Shortlisted papers in the brief window, interleaved so every domain and day gets its best papers
// scored first: rank 1 of each domain-day, then rank 2, and so on.
async function scoringQueue(): Promise<{ inWindow: number; ids: string[] }> {
  const window = briefWindow(new Date());
  const rows = await db.execute<{ paper_id: string }>(sql`
    with ranked as (
      select pd.paper_id, pd.cosine,
        row_number() over (
          partition by pd.domain_id, (coalesce(p.announced_at, p.submitted_at, p.created_at) at time zone 'UTC')::date
          order by pd.cosine desc nulls last) as rk
      from research_signal.paper_domain pd
      join research_signal.papers p on p.id = pd.paper_id
      join research_signal.domains d on d.id = pd.domain_id and d.active
      where p.status = 'SHORTLISTED'
        and coalesce(p.announced_at, p.submitted_at, p.created_at) >= ${window.start.toISOString()}
        and coalesce(p.announced_at, p.submitted_at, p.created_at) < ${window.end.toISOString()}
    )
    select paper_id from ranked group by paper_id order by min(rk), max(cosine) desc`);
  const inWindow = rows.map((r) => r.paper_id);
  // Then the rest of the shortlist (earlier weeks, or papers announced after the window), newest first,
  // so the queued score job can be settled once nothing is left.
  const rest = await db.execute<{ paper_id: string }>(sql`
    select p.id as paper_id
    from research_signal.papers p
    where p.status = 'SHORTLISTED'
      and exists (
        select 1 from research_signal.paper_domain pd
        join research_signal.domains d on d.id = pd.domain_id and d.active
        where pd.paper_id = p.id)
    order by coalesce(p.announced_at, p.submitted_at, p.created_at) desc`);
  const seen = new Set(inWindow);
  return { inWindow: inWindow.length, ids: [...inWindow, ...rest.map((r) => r.paper_id).filter((id) => !seen.has(id))] };
}

async function shortlistLeft(): Promise<boolean> {
  const [row] = await db.execute<{ id: string }>(sql`
    select id from research_signal.papers where status = 'SHORTLISTED' limit 1`);
  return Boolean(row);
}

// Papers a failed batch left SHORTLISTED get one more pass; a budget stop leaves the rest for the cron.
const SCORE_PASSES = 2;

async function scoreWithinBudget(): Promise<{ scored: number; windowLeft: number; left: number; spent: number; settled: number }> {
  let scored = 0;
  let perPaper = FALLBACK_COST_PER_PAPER;
  let windowLeft = 0;
  let left = 0;
  for (let pass = 0; pass < SCORE_PASSES; pass++) {
    const { inWindow, ids: queue } = await scoringQueue();
    windowLeft = inWindow;
    left = queue.length;
    if (queue.length === 0) break;
    if (pass > 0) console.log(`  retrying ${queue.length} papers still shortlisted after pass ${pass}`);
    let i = 0;
    while (i < queue.length) {
      const spent = await spentSinceStart();
      const room = budget - BRIEF_RESERVE_USD - spent;
      const affordable = Math.floor(room / perPaper);
      if (affordable < 1) break;
      const chunk = queue.slice(i, i + Math.min(SCORE_CHUNK, affordable));
      const result = await runScore({ paperIds: chunk });
      scored += result.scored;
      i += chunk.length;
      const cost = (await spentSinceStart()) - spent;
      if (result.scored > 0 && cost > 0) perPaper = Math.max(perPaper * 0.5, cost / result.scored);
      console.log(`  scored ${result.scored}/${chunk.length} (${result.failedBatches} failed batches), $${cost.toFixed(4)}, ~$${perPaper.toFixed(5)}/paper`);
    }
    if (i < queue.length) {
      // Out of budget: what was not reached stays queued for the cron's score job.
      windowLeft = Math.max(0, inWindow - i);
      left = queue.length - i;
      break;
    }
    const after = await scoringQueue();
    windowLeft = after.inWindow;
    left = after.ids.length;
  }
  // The score job is done only when the whole shortlist is scored.
  const settled = (await shortlistLeft()) ? 0 : await settleJobs("score");
  return { scored, windowLeft, left, spent: await spentSinceStart(), settled };
}

async function figuresLeft(): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from research_signal.papers
    where status = 'FINALIST' and arxiv_id is not null and figures is null`);
  return Number(row?.n ?? 0);
}

// Like the cron's enrich job, which queues figures: runs until every FINALIST has figures or a recorded
// attempt, stopping when a run makes no progress (fetch errors leave papers for the cron).
async function fetchFigures(): Promise<{ saved: number; left: number; settled: number }> {
  let saved = 0;
  let left = await figuresLeft();
  while (left > 0) {
    try {
      const outcome = await runFigures();
      saved += outcome.items;
      console.log(`  figures: ${outcome.status}, ${outcome.items} saved${outcome.error ? ` (${outcome.error})` : ""}`);
    } catch (error) {
      console.warn(`  figures: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    const next = await figuresLeft();
    if (next >= left) break;
    left = next;
  }
  const settled = left === 0 ? await settleJobs("figures") : 0;
  return { saved, left, settled };
}

async function main() {
  console.log(`backfill: ${weeks} week(s), LLM budget $${budget.toFixed(2)}`);
  const fetched = await stage("arxiv", fetchArxiv);
  console.log(`  ${fetched.fetched} fetched in ${fetched.pages} page(s), ${fetched.inserted} new papers`);

  await stage("embed1", async () => {
    for (let r = await runEmbed1(); r.processed > 0; r = await runEmbed1()) {
      console.log(`  embed1: ${r.processed} processed, ${r.prefiltered} prefiltered, ${r.dropped} dropped`);
    }
    await settleJobs("embed1");
  });
  await stage("embed2", async () => {
    for (let r = await runEmbed2(); r.shortlisted > 0; r = await runEmbed2()) {
      console.log(`  embed2: ${r.shortlisted} shortlisted`);
    }
    await settleJobs("embed2");
  });

  const scored = await stage("score", scoreWithinBudget);
  console.log(
    `  ${scored.scored} scored, ${scored.windowLeft} window and ${scored.left - scored.windowLeft} other shortlisted papers left unscored, ` +
      `${scored.settled} score job(s) settled, $${scored.spent.toFixed(4)} spent`,
  );

  await stage("enrich", async () => {
    const r = await runEnrich();
    for (const kind of ["hf", "openreview", "s2"] as const) {
      console.log(`  ${kind}: ${r[kind].status}, ${r[kind].items} snapshots${r[kind].error ? ` (${r[kind].error})` : ""}`);
    }
    console.log(`  rankAll: ranked ${r.ranked}, promoted ${r.promoted}`);
    await settleJobs("enrich");
  });

  const figures = await stage("figures", fetchFigures);
  console.log(`  ${figures.saved} papers' figures stored, ${figures.left} FINALISTs left, ${figures.settled} figures job(s) settled`);

  if (!values["no-brief"]) {
    const window = briefWindow(new Date());
    // The full-text rerank belongs to the Sunday run; the preview uses the stored scores.
    const built = await stage("brief", () => buildBrief(window, { rerank: false }));
    if (built.empty) console.log(`  no scored papers in ${window.label}; brief ${built.briefId} marked FAILED`);
    else {
      console.log(`  preview brief id: ${built.briefId} (${built.isoWeek}, READY, not sent)`);
      console.log(`  ${built.cards} cards, prose ${built.proseSource}, email ${built.bytes} bytes`);
    }
  }

  const [pending] = await db.execute<{ stages: string | null }>(sql`
    select string_agg(stage::text || ' x' || n, ', ') as stages
    from (select stage, count(*) as n from research_signal.jobs where status = 'PENDING' group by 1) j`);
  const [total] = await db.execute<{ usd: number | null; all_usd: number | null }>(sql`
    select (select sum(cost_usd)::float8 from research_signal.llm_calls where created_at >= ${runStart.toISOString()}) as usd,
      (select sum(cost_usd)::float8 from research_signal.llm_calls) as all_usd`);
  const elapsed = timings.reduce((sum, [, ms]) => sum + ms, 0);
  console.log("\ntiming:");
  for (const [name, ms] of timings) console.log(`  ${name.padEnd(8)} ${(ms / 1000).toFixed(1)} s`);
  console.log(`  total    ${(elapsed / 1000).toFixed(1)} s`);
  console.log(`cost (llm_calls since start): $${Number(total?.usd ?? 0).toFixed(4)}; all-time $${Number(total?.all_usd ?? 0).toFixed(4)}`);
  console.log(`jobs still pending: ${pending?.stages ?? "none"}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  })
  .finally(() => db.$client.end());
