import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";

const MODEL_LISTS = [
  "https://openrouter.ai/api/v1/models",
  "https://openrouter.ai/api/v1/embeddings/models",
];

async function fetchIds(url: string): Promise<string[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  const body = (await response.json()) as { data?: { id?: unknown }[] };
  return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export function closestGoogleId(target: string, available: string[]): string | undefined {
  let best: string | undefined;
  let bestLength = -1;
  for (const id of available) {
    if (!id.startsWith("google/") || id.includes(":")) continue;
    const length = commonPrefixLength(target, id);
    if (length > bestLength) {
      best = id;
      bestLength = length;
    }
  }
  return best;
}

async function configuredIds(): Promise<string[]> {
  const [row] = await db
    .select({ chatModel: appSettings.chatModel, embedModel: appSettings.embedModel })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  if (!row) throw new Error("app_settings row is missing; run npm run seed");
  return [row.chatModel, row.embedModel];
}

export async function checkModels(): Promise<{ missing: string[]; suggestions: Record<string, string> }> {
  const [configured, ...lists] = await Promise.all([configuredIds(), ...MODEL_LISTS.map(fetchIds)]);
  const available = [...new Set(lists.flat())];
  const known = new Set(available);
  const missing = configured.filter((id) => !known.has(id));
  const suggestions: Record<string, string> = {};
  for (const id of missing) {
    const suggestion = closestGoogleId(id, available);
    if (suggestion) suggestions[id] = suggestion;
  }
  return { missing, suggestions };
}
