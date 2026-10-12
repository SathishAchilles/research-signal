import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { runScore } from "@/lib/pipeline/score";

const MAX_WORDS = 18;

// Scores one batch of SHORTLISTED papers (default 25). Usage: npm run smoke -- score [limit]
export default async function run(args: string[]) {
  try {
    const limit = Number(args[0] ?? 25);
    const started = new Date();
    const result = await runScore({ limit });
    console.log(
      `scored ${result.scored} papers in ${result.batches} batch(es), ${result.failedBatches} failed; ranked ${result.ranked}, promoted ${result.promoted}`,
    );

    const rows = await db.execute<{ paper_id: string; signal_type: string; client_angle: string | null; relevance: number }>(sql`
      select pd.paper_id, pd.signal_type, pd.client_angle, pd.llm_relevance as relevance
      from research_signal.paper_domain pd
      where pd.scored_at >= ${started.toISOString()}::timestamptz`);
    const byPaper = new Map(rows.map((r) => [r.paper_id, r]));
    const distribution: Record<string, number> = {};
    for (const r of byPaper.values()) distribution[r.signal_type] = (distribution[r.signal_type] ?? 0) + 1;
    console.log(`signalType distribution: ${JSON.stringify(distribution)}`);

    const words = rows.map((r) => (r.client_angle ?? "").trim().split(/\s+/).filter(Boolean).length);
    console.log(`client_angle words: max ${Math.max(0, ...words)} over ${rows.length} rows`);
    const sample = [...byPaper.values()][0];
    if (sample) console.log(`sample client_angle: "${sample.client_angle}"`);
    if (words.some((n) => n > MAX_WORDS)) throw new Error(`a client_angle has more than ${MAX_WORDS} words`);

    const [cost] = await db.execute<{ usd: number | null; calls: number }>(sql`
      select sum(cost_usd)::float as usd, count(*)::int as calls from research_signal.llm_calls
      where stage = 'score' and created_at >= ${started.toISOString()}::timestamptz`);
    console.log(`llm calls ${cost.calls}, cost $${Number(cost.usd ?? 0).toFixed(5)}`);
  } finally {
    await db.$client.end();
  }
}
