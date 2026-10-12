import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { runEnrich } from "@/lib/pipeline/enrich";

async function finalistEvidence() {
  return db.execute<{ rung: string; n: number; with_s2: number; with_or: number; with_hf: number }>(sql`
    select e.rung, count(*)::int as n,
      count(e.s2_citations)::int as with_s2,
      count(coalesce(e.or_venue, e.or_decision))::int as with_or,
      count(e.linked_models)::int as with_hf
    from research_signal.papers p join research_signal.evidence e on e.paper_id = p.id
    where p.status = 'FINALIST' group by 1 order by 1`);
}

function print(label: string, rows: Awaited<ReturnType<typeof finalistEvidence>>) {
  console.log(`${label}:`);
  for (const r of rows) console.log(`  ${r.rung}: ${r.n} finalists (hf detail ${r.with_hf}, s2 ${r.with_s2}, openreview ${r.with_or})`);
}

export default async function run() {
  try {
    print("FINALIST evidence before", await finalistEvidence());
    const result = await runEnrich();
    for (const kind of ["hf", "openreview", "s2"] as const) {
      const o = result[kind];
      console.log(`${kind}: ${o.status}, ${o.items} snapshots${o.error ? ` (${o.error})` : ""}`);
    }
    console.log(`rankAll: ranked ${result.ranked}, promoted ${result.promoted}`);
    print("FINALIST evidence after", await finalistEvidence());

    const [codePlus] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from research_signal.evidence e
      join research_signal.papers p on p.id = e.paper_id
      where e.rung in ('CODE', 'MODEL', 'PEER') and p.status in ('SCORED', 'FINALIST')`);
    console.log(`scored/finalist papers with rung CODE or higher: ${codePlus.n}`);
    if (codePlus.n === 0) throw new Error("no scored paper has rung CODE or higher");
  } finally {
    await db.$client.end();
  }
}
