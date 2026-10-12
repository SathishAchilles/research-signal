import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { askTools, createAskContext } from "@/lib/ask/tools";

type Executable = { execute?: (input: never, options: never) => unknown };

async function call(tools: Record<string, Executable>, name: string, input: unknown) {
  const output = (await tools[name].execute!(input as never, { toolCallId: name, messages: [] } as never)) as Record<string, unknown>;
  const counts = Object.entries(output)
    .map(([key, value]) => (Array.isArray(value) ? `${key}=${value.length}` : null))
    .filter(Boolean);
  const notes = ["skipped", "error", "reason", "momentum", "source"]
    .filter((key) => key in output)
    .map((key) => `${key}=${JSON.stringify(output[key])}`);
  const text = typeof output.text === "string" ? [`text=${output.text.length} chars`] : [];
  console.log(`${name}: ${[...counts, ...notes, ...text].join(" ")}`);
  return output;
}

export default async function run(args: string[]) {
  const liveQuery = args[0] ?? "speculative decoding for diffusion language models";
  try {
    const [first] = await db.execute<{ at: string | null }>(sql`
      select min(published_at) as at from research_signal.search_docs where entity_type = 'paper'`);
    const ctx = createAskContext(
      { intent: "EXPLAIN", bareTerm: true, entities: ["agentic RAG"], domains: [2], since: "2026-09-01" },
      first?.at ? new Date(first.at) : null,
    );
    const tools = askTools(ctx) as unknown as Record<string, Executable>;

    await call(tools, "search_index", { q: "agentic RAG", filters: {} });
    await call(tools, "get_papers", { ids: ["p1", "p2", "p3"] });
    await call(tools, "trend", { q: "retrieval", since: "2026-08-01", bucket: "week" });
    await call(tools, "related", { paperId: "p1" });
    await call(tools, "my_log", {});
    await call(tools, "get_fulltext", { paperId: "p1" });

    // A narrow query keeps strongHits under the live threshold so the gate opens.
    // A narrow query in an unrelated domain; the gate opens on fewer than 5 hits with cosine >= 0.35.
    // strongHits keeps the best count of the question, so it is reset to this search's count first.
    ctx.strongHits = null;
    const narrow = await call(tools, "search_index", { q: liveQuery, filters: { domainId: 4 } });
    console.log(`strongHits for the live query: ${String(narrow.strongHits)}`);
    if (!narrow.liveSearchAllowed) console.log("live gate closed: live_search will report skipped");
    await call(tools, "live_search", { q: liveQuery });
    console.log(`live: found=${ctx.live.found} inserted=${ctx.live.inserted} refs=${ctx.refs.size}`);

    const [queued] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from research_signal.jobs where stage = 'embed2' and status = 'PENDING'`);
    const [live] = await db.execute<{ n: number; prefiltered: number; domains: number }>(sql`
      select count(*)::int as n,
        count(*) filter (where status = 'PREFILTERED')::int as prefiltered,
        (select count(*)::int from research_signal.paper_domain pd join research_signal.papers lp on lp.id = pd.paper_id where lp.source = 'live') as domains
      from research_signal.papers where source = 'live'`);
    console.log(`live papers=${live.n} prefiltered=${live.prefiltered} paper_domain=${live.domains} embed2 pending=${queued.n}`);
  } finally {
    await db.$client.end();
  }
}
