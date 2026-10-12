import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  FINALISTS_PER_DOMAIN,
  RANK_WINDOW_DAYS,
  type ScoreInput,
  finalScore,
  rankAll,
  verdictFor,
} from "@/lib/pipeline/rank";

const input: ScoreInput = {
  cosine: 0.6,
  llmRelevance: 4,
  novelty: 3,
  signalType: "BENCH",
  upvotes: 50,
  stars: 300,
  linked: 1,
  rung: "MODEL",
};

// By hand, with the default weights:
//   0.35·0.7 + 0.30·0.76 + 0.20·(0.5·0.6829 + 0.3·0.6194 + 0.2·0.2) + 0.15·0.66
//   relevance 0.5·0.6 + 0.5·(4/5) = 0.7; significance 0.6·(3/5) + 0.4·1.0 = 0.76
//   attention log10(51)/2.5 ≈ 0.683, log10(301)/4 ≈ 0.6196, 1/5 = 0.2; validation MODEL = 0.66
//   ≈ 0.685
const HAND = 0.35 * 0.7 + 0.3 * 0.76 + 0.2 * (0.5 * 0.6829 + 0.3 * 0.6194 + 0.2 * 0.2) + 0.15 * 0.66;

export default async function run(args: string[]) {
  try {
    const final = finalScore(input, DEFAULT_WEIGHTS);
    console.log(`finalScore ${final.toFixed(4)} (by hand ${HAND.toFixed(4)})`);
    console.log(`verdict ${verdictFor(final, input.rung, DEFAULT_THRESHOLDS)}`);
    if (final.toFixed(3) !== HAND.toFixed(3)) throw new Error(`finalScore ${final} does not match ${HAND} to 3 decimals`);

    const checks: [number, ScoreInput["rung"], string][] = [
      [0.75, "LAB", "READ"],
      [0.75, "CODE", "CLIENT"],
      [0.55, "PEER", "READ"],
      [0.4, "PEER", "SKIP"],
    ];
    for (const [score, rung, expected] of checks) {
      const got = verdictFor(score, rung, DEFAULT_THRESHOLDS);
      console.log(`verdictFor(${score}, ${rung}) = ${got}`);
      if (got !== expected) throw new Error(`expected ${expected}`);
    }

    if (args.includes("--all")) {
      const result = await rankAll();
      console.log(`rankAll: ranked ${result.ranked} rows, promoted ${result.promoted}, demoted ${result.demoted}`);
      const rows = await db.execute<{ domain: string; finalists: number; top: number | null }>(sql`
        select d.name as domain, count(distinct pd.paper_id) filter (where p.status = 'FINALIST')::int as finalists,
          max(pd.final_score) as top
        from research_signal.paper_domain pd
        join research_signal.papers p on p.id = pd.paper_id
        join research_signal.domains d on d.id = pd.domain_id
        where pd.final_score is not null
          and coalesce(p.announced_at, p.submitted_at, p.created_at) >= now() - make_interval(days => ${RANK_WINDOW_DAYS})
        group by 1 order by 1`);
      for (const r of rows) console.log(`  ${r.domain}: ${r.finalists} finalists, top ${Number(r.top).toFixed(3)}`);
      const over = rows.filter((r) => r.finalists > FINALISTS_PER_DOMAIN);
      if (over.length) throw new Error(`more than ${FINALISTS_PER_DOMAIN} finalists in ${over.map((r) => r.domain).join(", ")}`);

      const again = await rankAll();
      console.log(`rankAll again: promoted ${again.promoted}, demoted ${again.demoted}`);
      if (again.promoted || again.demoted) throw new Error("a second rankAll changed finalists");
    }
  } finally {
    await db.$client.end();
  }
}
