// npm run smoke -- figures [arxivId]  extracts figures from one paper's arXiv HTML and stores them.
// npm run smoke -- figures --stage    runs the figures stage once (not drain), then reports how many
//                                     FINALISTs of the current brief week have a lead figure, by source.
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { briefWindow } from "@/lib/brief/window";
import { runFigures } from "@/lib/pipeline/stages";
import { fetchArxivFigures, saveFigures } from "@/lib/sources/fulltext";
import { withArxivLease } from "@/lib/sources/lease";

async function one(arxivId: string) {
  const figures = await withArxivLease(
    "smoke-figures",
    async (wait) => {
      await wait();
      return fetchArxivFigures(arxivId);
    },
    { maxWaitMs: 60_000 },
  );
  if (figures === "busy") throw new Error("arXiv lease busy");
  console.log(`${arxivId}: ${figures.length} figures`);
  figures.forEach((f, i) => console.log(`  ${i + 1}. ${f.url}\n     ${f.caption}`));
  await saveFigures(arxivId, figures);
  const [row] = await db.execute<{ figure_url: string | null; figure_source: string | null; n: number | null }>(sql`
    select figure_url, figure_source, jsonb_array_length(figures) as n
    from research_signal.papers where arxiv_id = ${arxivId}`);
  console.log(row ? `stored: figures=${row.n} lead=${row.figure_source} ${row.figure_url}` : "paper not in the database");
  if (!figures[0]) process.exitCode = 1;
}

async function stage() {
  const outcome = await runFigures();
  console.log(`figures stage: ${outcome.status} items=${outcome.items}${outcome.error ? ` error=${outcome.error}` : ""}`);
  const window = briefWindow(new Date());
  const rows = await db.execute<{ source: string; n: number; attempted: number }>(sql`
    select coalesce(figure_source, 'none') as source, count(*)::int as n, count(figures)::int as attempted
    from research_signal.papers
    where status = 'FINALIST'
      and coalesce(announced_at, submitted_at, created_at) >= ${window.start.toISOString()}::timestamptz
      and coalesce(announced_at, submitted_at, created_at) < ${window.end.toISOString()}::timestamptz
    group by 1 order by 2 desc`);
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  console.log(`FINALISTs in ${window.isoWeek} (${window.label}): ${total}`);
  for (const r of rows) console.log(`  ${r.source}: ${r.n} (figures attempted: ${r.attempted})`);
  const all = await db.execute<{ source: string; n: number; attempted: number }>(sql`
    select coalesce(figure_source, 'none') as source, count(*)::int as n, count(figures)::int as attempted
    from research_signal.papers where status = 'FINALIST' group by 1 order by 2 desc`);
  console.log(`all FINALISTs: ${all.reduce((sum, r) => sum + r.n, 0)}`);
  for (const r of all) console.log(`  ${r.source}: ${r.n} (figures attempted: ${r.attempted})`);
  const missing = rows.find((r) => r.source === "none");
  if (missing && missing.attempted < missing.n) process.exitCode = 1;
}

export default async function run(args: string[]) {
  try {
    if (args[0] === "--stage") await stage();
    else await one(args[0] ?? "2610.12242");
  } finally {
    await db.$client.end();
  }
}
