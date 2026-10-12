import { count, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { llmCalls, searchDocs } from "@/db/schema";
import { type SearchDocInput, upsertSearchDoc, upsertSearchDocs } from "@/lib/search";
import { search } from "@/lib/search/query";

const PREFIX = "smoke-search-";

const fixtures: SearchDocInput[] = [
  {
    entityType: "summary",
    entityId: `${PREFIX}swe`,
    title: "SWE-bench Verified: resolving real GitHub issues with language-model agents",
    body: "We evaluate coding agents on SWE-bench, a benchmark of real repository issues and unit tests.",
    facets: { domainIds: [9001], source: "arxiv", rung: "CODE", hasCode: true, attention: 0.4, publishedAt: new Date("2026-10-01") },
  },
  {
    entityType: "summary",
    entityId: `${PREFIX}fc`,
    title: "Function calling for LLM agents: learning when to invoke external APIs",
    body: "Language models are trained to emit structured calls to calculators, search engines and code interpreters.",
    facets: { domainIds: [9001], source: "hf", rung: "MODEL", hasCode: false, attention: 0.9, publishedAt: new Date("2026-10-05") },
  },
  {
    entityType: "summary",
    entityId: `${PREFIX}bio`,
    title: "Protein folding with diffusion priors",
    body: "A structural biology method for predicting protein conformations.",
    facets: { domainIds: [9002], source: "arxiv", rung: "LAB", hasCode: false, attention: 0.1, publishedAt: new Date("2026-09-20") },
  },
];

const embedCalls = async () =>
  (await db.select({ n: count() }).from(llmCalls).where(eq(llmCalls.stage, "search_index")))[0].n;

const show = (label: string, hits: Awaited<ReturnType<typeof search>>) => {
  console.log(`${label}:`);
  for (const h of hits) console.log(`  ${h.score.toFixed(4)}  ${h.entityId}  ${h.title.slice(0, 60)}`);
};

async function clean() {
  const removed = await db
    .delete(searchDocs)
    .where(like(searchDocs.entityId, `${PREFIX}%`))
    .returning({ id: searchDocs.id });
  const [left] = await db.select({ n: count() }).from(searchDocs).where(like(searchDocs.entityId, `${PREFIX}%`));
  console.log(`removed ${removed.length} fixture rows; ${left.n} left`);
}

async function seed() {
  const first = await upsertSearchDocs(fixtures);
  console.log(`seeded: ${first.map((r) => `${r.entityId} embedded=${r.embedded}`).join(", ")}`);

  const before = await embedCalls();
  const again = await upsertSearchDoc({ ...fixtures[0], facets: { attention: 0.5 } });
  const after = await embedCalls();
  console.log(`re-upsert unchanged text: embedded=${again.embedded}, search_index llm_calls ${before} -> ${after}`);
  if (again.embedded || after !== before) throw new Error("unchanged text was re-embedded");
}

async function verify() {
  const scoped = { domainId: 9001 };
  const exact = await search({ q: "SWE-bench" });
  show('q="SWE-bench"', exact);
  if (!exact[0]?.title.includes("SWE")) throw new Error("first hit for SWE-bench does not contain SWE");

  const synonym = await search({ q: "tool-using agents", filters: scoped });
  show('q="tool-using agents" domainId=9001', synonym);
  if (!synonym.some((h) => h.entityId === `${PREFIX}fc`)) throw new Error("synonym query missed the function-calling doc");

  const rung = await search({ q: "agents", filters: { ...scoped, minRung: "MODEL" } });
  show('q="agents" minRung=MODEL', rung);
  if (rung.some((h) => h.entityId === `${PREFIX}swe`)) throw new Error("minRung filter let a CODE doc through");

  const byAttention = await search({ filters: scoped, sort: "attention" });
  show("empty q, domainId=9001, sort=attention", byAttention);
  if (byAttention[0]?.entityId !== `${PREFIX}fc`) throw new Error("attention sort is wrong");

  const byDate = await search({ q: "agents", filters: scoped, sort: "date" });
  show('q="agents" sort=date', byDate);
}

export default async function run(args: string[]) {
  const mode = args[0] ?? "all";
  try {
    if (mode === "seed") await seed();
    else if (mode === "clean") await clean();
    else if (mode === "verify") await verify();
    else {
      await seed();
      try {
        await verify();
      } finally {
        await clean();
      }
    }
  } finally {
    await db.$client.end();
  }
}
