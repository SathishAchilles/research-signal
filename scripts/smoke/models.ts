import { db } from "@/db/client";
import { checkModels } from "@/lib/llm/models-check";

export default async function run() {
  try {
    const { missing, suggestions } = await checkModels();
    console.log(`missing: ${JSON.stringify(missing)}`);
    console.log(`suggestions: ${JSON.stringify(suggestions)}`);
    if (missing.length > 0) throw new Error("configured models are missing from OpenRouter");
  } finally {
    await db.$client.end();
  }
}
