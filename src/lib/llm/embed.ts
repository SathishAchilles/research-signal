import { embedMany } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { llmCall } from "./call";
import { embedModel } from "./openrouter";

const BATCH_SIZE = 100;
const DIMENSIONS = 768;

export function toUnit768(v: number[]): number[] {
  const head = v.slice(0, DIMENSIONS);
  if (head.length !== DIMENSIONS) {
    throw new Error(`Embedding has ${v.length} dimensions; at least ${DIMENSIONS} are required`);
  }
  const norm = Math.sqrt(head.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) throw new Error("Cannot normalise a zero vector");
  return head.map((x) => x / norm);
}

async function configuredEmbedModel(): Promise<string> {
  const [row] = await db
    .select({ embedModel: appSettings.embedModel })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  if (!row) throw new Error("app_settings row is missing; run npm run seed");
  return row.embedModel;
}

export async function embedTexts(texts: string[], stage: string): Promise<number[][]> {
  if (texts.length === 0) return [];
  const modelId = await configuredEmbedModel();
  const model = embedModel(modelId);
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const values = texts.slice(i, i + BATCH_SIZE);
    const { embeddings } = await llmCall(stage, modelId, () =>
      embedMany({ model, values, maxRetries: 0 }),
    );
    vectors.push(...embeddings.map(toUnit768));
  }
  return vectors;
}
