import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { announceDay, runEmbed1, runEmbed2 } from "@/lib/pipeline/embed";

const CAP = 40;

export default async function run() {
  try {
    const first = await runEmbed1();
    console.log(`embed1: processed ${first.processed}, prefiltered ${first.prefiltered}, dropped ${first.dropped}`);
    const second = await runEmbed2();
    console.log(`embed2: shortlisted ${second.shortlisted}${second.remaining ? " (more remain)" : ""}`);

    const rows = await db.execute<{ domain: string; day: string; n: number; shortlisted: number }>(sql`
      select d.name as domain, ${announceDay()} as day, count(*)::int as n,
        count(*) filter (where p.status = 'SHORTLISTED')::int as shortlisted
      from research_signal.paper_domain pd
      join research_signal.papers p on p.id = pd.paper_id
      join research_signal.domains d on d.id = pd.domain_id
      where p.status <> 'DROPPED' and p.source <> 'live'
      group by 1, 2 order by 2 desc, 1`);
    for (const r of rows) console.log(`${r.day}  ${r.domain}: ${r.n} kept, ${r.shortlisted} shortlisted`);

    const status = await db.execute<{ status: string; n: number }>(sql`
      select status, count(*)::int as n from research_signal.papers group by 1 order by 1`);
    console.log(`papers by status: ${status.map((s) => `${s.status}=${s.n}`).join(", ")}`);

    const over = rows.filter((r) => Number(r.n) > CAP);
    if (over.length > 0) throw new Error(`domains above ${CAP} for a day: ${over.map((r) => `${r.domain} ${r.day}`).join(", ")}`);
  } finally {
    await db.$client.end();
  }
}
