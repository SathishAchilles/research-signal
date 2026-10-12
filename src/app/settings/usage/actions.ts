"use server";

import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { closestGoogleId } from "@/lib/llm/models-check";
import { errorMessage } from "@/lib/sources/types";
import { hasSession, SESSION_EXPIRED } from "../_lib/guard";
import { modelFormatError } from "../_lib/validation";

export type ModelsResult = { ok: true } | { ok: false; error: string };

const MODEL_LISTS = {
  chat: "https://openrouter.ai/api/v1/models",
  embed: "https://openrouter.ai/api/v1/embeddings/models",
} as const;

async function listIds(url: string): Promise<string[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`OpenRouter model list returned HTTP ${response.status}`);
  const body = (await response.json()) as { data?: { id?: unknown }[] };
  return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
}

function unavailable(id: string, available: string[]): string {
  const suggestion = closestGoogleId(id, available);
  return `${id} is not available on OpenRouter${suggestion ? `; closest is ${suggestion}` : ""}.`;
}

export async function saveModels(input: { chatModel: string; embedModel: string }): Promise<ModelsResult> {
  if (!(await hasSession())) return { ok: false, error: SESSION_EXPIRED };
  const chatModel = input.chatModel.trim();
  const embedModel = input.embedModel.trim();
  const formatError = modelFormatError(chatModel) ?? modelFormatError(embedModel);
  if (formatError) return { ok: false, error: formatError };

  let chatIds: string[];
  let embedIds: string[];
  try {
    [chatIds, embedIds] = await Promise.all([listIds(MODEL_LISTS.chat), listIds(MODEL_LISTS.embed)]);
  } catch (error) {
    return { ok: false, error: `Could not check models: ${errorMessage(error)}` };
  }
  if (!chatIds.includes(chatModel)) return { ok: false, error: unavailable(chatModel, chatIds) };
  if (!embedIds.includes(embedModel)) return { ok: false, error: unavailable(embedModel, embedIds) };

  await db
    .update(appSettings)
    .set({ chatModel, embedModel, updatedAt: sql`now()` })
    .where(eq(appSettings.id, 1));
  refresh();
  return { ok: true };
}
