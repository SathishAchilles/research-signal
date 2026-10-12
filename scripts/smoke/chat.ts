import { generateText } from "ai";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { llmCalls } from "@/db/schema";
import { llmCall } from "@/lib/llm/call";
import { chatModel } from "@/lib/llm/openrouter";

const MODEL = "google/gemini-3.7-flash";
const STAGE = "smoke_chat";

export default async function run() {
  try {
    const result = await llmCall(STAGE, MODEL, () =>
      generateText({ model: chatModel(MODEL), prompt: "Reply with the word ready.", maxRetries: 0 }),
    );
    const meta = result.providerMetadata?.openrouter as
      | { provider?: string; usage?: { cost?: number; costDetails?: { upstreamInferenceCost?: number } } }
      | undefined;
    console.log(`text: ${result.text.trim()}`);
    console.log(`provider: ${meta?.provider}`);
    console.log(
      `cost: ${meta?.usage?.cost} upstream_inference_cost: ${meta?.usage?.costDetails?.upstreamInferenceCost}`,
    );

    const [row] = await db
      .select({ id: llmCalls.id, costUsd: llmCalls.costUsd })
      .from(llmCalls)
      .where(eq(llmCalls.stage, STAGE))
      .orderBy(desc(llmCalls.id))
      .limit(1);
    console.log(`llm_calls row: id=${row?.id} cost_usd=${row?.costUsd}`);

    if (!/ready/i.test(result.text)) throw new Error("reply does not contain 'ready'");
    if (!meta?.provider || !/google/i.test(meta.provider)) throw new Error("provider is not Google");
  } finally {
    await db.$client.end();
  }
}
