import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { llmCalls } from "@/db/schema";
import { embedTexts } from "@/lib/llm/embed";

const STAGE = "smoke_embed";

const norm = (v: number[]) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);

export default async function run() {
  try {
    const [a, b] = await embedTexts(["retrieval augmented generation", "RAG"], STAGE);
    const cosine = dot(a, b) / (norm(a) * norm(b));
    console.log(`lengths: ${a.length}, ${b.length}`);
    console.log(`norms: ${norm(a).toFixed(3)}, ${norm(b).toFixed(3)}`);
    console.log(`cosine: ${cosine.toFixed(3)}`);

    const [row] = await db
      .select()
      .from(llmCalls)
      .where(eq(llmCalls.stage, STAGE))
      .orderBy(desc(llmCalls.id))
      .limit(1);
    console.log(
      `llm_calls row: id=${row?.id} provider=${row?.provider} prompt_tokens=${row?.promptTokens} cost_usd=${row?.costUsd}`,
    );

    if (a.length !== 768 || b.length !== 768) throw new Error("expected 768 dimensions");
    if (Math.abs(norm(a) - 1) > 0.001 || Math.abs(norm(b) - 1) > 0.001) throw new Error("vectors are not unit length");
    if (!(cosine > 0.6)) throw new Error("cosine is not above 0.6");
    if (!row) throw new Error("no llm_calls row was written");
  } finally {
    await db.$client.end();
  }
}
