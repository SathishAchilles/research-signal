import { db } from "@/db/client";
import { routeIntent } from "@/lib/ask/route-intent";

const CASES = [
  { prompt: "agentic RAG", expected: "EXPLAIN" },
  { prompt: "Should a client bet on mixture-of-agents?", expected: "BET" },
  { prompt: "Prep me for Acme on CV QA", expected: "PREP" },
];

export default async function run() {
  try {
    const failures: string[] = [];
    for (const c of CASES) {
      const routed = await routeIntent(c.prompt);
      const extra = routed.bareTerm ? "+CATCHUP" : "";
      console.log(
        `${c.prompt} -> ${routed.intent}${extra} entities=${JSON.stringify(routed.entities)} domains=${JSON.stringify(routed.domains)} since=${routed.since ?? "-"} client=${routed.client ?? "-"}`,
      );
      if (routed.intent !== c.expected) failures.push(`${c.prompt}: expected ${c.expected}, got ${routed.intent}`);
    }
    if (failures.length) throw new Error(failures.join("; "));
  } finally {
    await db.$client.end();
  }
}
