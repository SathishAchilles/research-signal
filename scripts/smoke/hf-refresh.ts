import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { hfRefresh } from "@/lib/pipeline/stages";

const countSignals = async () =>
  Number((await db.execute<{ n: number }>(sql`select count(*)::int as n from research_signal.signals`))[0].n);

// Runs hf_refresh in-process. The route is exercised with: npm run smoke -- hf-refresh --route <port>
export default async function run(args: string[]) {
  try {
    const [eligible] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from research_signal.papers p
      where p.arxiv_id is not null and p.status in ('SHORTLISTED', 'SCORED', 'FINALIST', 'SENT')
        and coalesce(p.announced_at, p.submitted_at, p.created_at) >= now() - interval '10 days'`);
    const before = await countSignals();
    const routePort = args[0] === "--route" ? Number(args[1] ?? 3107) : null;

    let written: number;
    let status: string | null;
    if (routePort) {
      const startedAt = new Date().toISOString();
      const response = await fetch(`http://localhost:${routePort}/api/stage/hf_refresh`, {
        method: "POST",
        headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
      });
      console.log(`POST /api/stage/hf_refresh -> ${response.status} ${await response.text()}`);
      let run: { status: string | null; items: number | null } | undefined;
      for (let i = 0; i < 120 && !run?.status; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        [run] = await db.execute<{ status: string | null; items: number | null }>(sql`
          select status, items from research_signal.source_runs
          where source_kind = 'hf' and stage = 'hf_refresh' and started_at >= ${startedAt}::timestamptz
          order by started_at desc limit 1`);
      }
      if (!run?.status) throw new Error("hf_refresh run did not finish within 240 s");
      console.log(`source_runs hf/hf_refresh: ${run.status}, items ${run.items}`);
      written = Number(run.items);
      status = run.status;
    } else {
      const outcome = await hfRefresh();
      console.log(`hfRefresh: ${outcome.status}, items ${outcome.items}${outcome.error ? ` (${outcome.error})` : ""}`);
      written = outcome.items;
      status = outcome.status;
    }

    const after = await countSignals();
    console.log(`eligible papers ${eligible.n}, listed on HF ${written}, signals ${before} -> ${after} (+${after - before})`);
    if (status !== "OK") throw new Error(`hf_refresh finished with status ${status}, expected OK`);
    if (eligible.n > 0 && written <= 0) throw new Error(`no HF snapshots written for ${eligible.n} eligible papers`);
    if (after - before !== written) throw new Error("signals growth does not match the snapshots written");
  } finally {
    await db.$client.end();
  }
}
