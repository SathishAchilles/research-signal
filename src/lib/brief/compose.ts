import { readFileSync } from "node:fs";
import path from "node:path";
import { generateObject } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { llmCall } from "@/lib/llm/call";
import { chatModel } from "@/lib/llm/openrouter";
import { fallbackProse } from "./fallback";
import { BriefProse, type BriefCard, type BriefSelection, EVIDENCE_FIELDS } from "./types";
import { TOTAL_WORD_CAP, validateProse } from "./validate";

const TEMPERATURE = 0.4;
const ABSTRACT_CHARS = 700;

export type ComposeResult = { prose: BriefProse; source: "llm" | "repaired" | "fallback"; errors: string[] };

let rules: string | undefined;
function loadRules(): string {
  rules ??= readFileSync(path.join(process.cwd(), "src/lib/brief/prompts/compose.md"), "utf8");
  return rules;
}

const untrusted = (text: string) => text.replace(/<\/?\s*card\b[^>]*>/gi, " ").replace(/\s+/g, " ").trim();

function cardBlock(card: BriefCard): string {
  const fields = EVIDENCE_FIELDS.filter((f) => typeof card.evidence[f] === "number")
    .map((f) => `${f}=${card.evidence[f]}`)
    .join(", ");
  return [
    `<card id="${card.cardId}" tier="${card.tier}" verdict="${card.verdict}" rung="${card.rung}" signal="${card.signalType}">`,
    `Title: ${untrusted(card.title)}`,
    `Abstract: ${untrusted(card.abstract).slice(0, ABSTRACT_CHARS)}`,
    `Stored client angle: ${untrusted(card.clientAngle)}`,
    `Evidence fields: ${fields || "final_score only"}`,
    `</card>`,
  ].join("\n");
}

function userPrompt(selection: BriefSelection): string {
  const cards = selection.cards;
  const parts = [`Week: ${selection.label}.`, "", `Top 3 cards, in order: ${selection.top3.join(", ") || "(none)"}.`];
  for (const d of selection.domains) {
    parts.push("", `## Domain ${d.domainId}: ${d.name}`);
    const listed = [d.hero, ...d.standard].filter((id): id is string => Boolean(id));
    parts.push(`Cards needing prose: ${listed.join(", ") || "(none)"}.`);
    if (d.compact.length) parts.push(`Compact rows (no prose needed): ${d.compact.map((id) => untrusted(cards[id].title)).join(" | ")}`);
    if (d.quiet) parts.push(`Quiet domain. Nearest miss: ${d.nearestMiss ? untrusted(d.nearestMiss.title) : "none"}.`);
  }
  parts.push("", `Rising cards: ${selection.rising.join(", ") || "(none)"}.`, "", "## Cards");
  const described = new Set([
    ...selection.top3,
    ...selection.rising,
    ...selection.domains.flatMap((d) => [d.hero, ...d.standard].filter((id): id is string => Boolean(id))),
  ]);
  for (const id of described) parts.push(cardBlock(cards[id]));
  return parts.join("\n");
}

// Keeps exactly the entries the selection asks for, in its order; anything the model left out comes
// from the deterministic fallback so one omission does not discard the whole brief.
export function normalizeProse(raw: BriefProse, selection: BriefSelection): BriefProse {
  const fallback = fallbackProse(selection);
  const top3 = new Map(raw.top3.map((t) => [t.cardId.trim(), t]));
  const domains = new Map(raw.domains.map((d) => [Number(d.domainId), d]));
  const rising = new Map(raw.rising.map((r) => [r.cardId.trim(), r]));
  return {
    weekLine: raw.weekLine.trim() || fallback.weekLine,
    top3: fallback.top3.map((f) => ({ ...(top3.get(f.cardId) ?? f), cardId: f.cardId })),
    domains: fallback.domains.map((f) => {
      const d = domains.get(f.domainId);
      if (!d) return f;
      const cards = new Map(d.cards.map((c) => [c.cardId.trim(), c]));
      return {
        domainId: f.domainId,
        situation: d.situation,
        complication: d.complication,
        implication: d.implication,
        cards: f.cards.map((fc) => {
          const c = cards.get(fc.cardId) ?? fc;
          const hero = selection.cards[fc.cardId].tier === "HERO";
          return { ...c, cardId: fc.cardId, lede: hero ? c.lede : undefined };
        }),
      };
    }),
    rising: fallback.rising.map((f) => ({ ...(rising.get(f.cardId) ?? f), cardId: f.cardId })),
  };
}

async function proseWordCap(): Promise<{ model: string; cap: number }> {
  const [row] = await db
    .select({ chatModel: appSettings.chatModel, cap: appSettings.proseWordCap })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  if (!row) throw new Error("app_settings row is missing; run npm run seed");
  return { model: row.chatModel, cap: Math.min(row.cap, TOTAL_WORD_CAP) };
}

// One generateObject call, one repair call with the validator's errors, then the deterministic fallback.
export async function composeBrief(selection: BriefSelection): Promise<ComposeResult> {
  const { model, cap } = await proseWordCap();
  const system = loadRules();
  const prompt = userPrompt(selection);
  const call = (messages: string) =>
    llmCall("compose", model, () =>
      generateObject({ model: chatModel(model), schema: BriefProse, system, prompt: messages, temperature: TEMPERATURE, maxRetries: 0 }),
    );

  let first: BriefProse;
  try {
    first = normalizeProse((await call(prompt)).object, selection);
  } catch (error) {
    console.warn(`compose failed: ${error instanceof Error ? error.message : String(error)}`);
    return { prose: fallbackProse(selection), source: "fallback", errors: ["compose call failed"] };
  }
  const errors = validateProse(first, selection, cap);
  if (errors.length === 0) return { prose: first, source: "llm", errors };

  try {
    const repairPrompt = `${prompt}\n\n## Your previous answer\n\n${JSON.stringify(first)}\n\n## It broke these rules; fix every one and return the whole object again\n\n${errors.map((e) => `- ${e}`).join("\n")}`;
    const repaired = normalizeProse((await call(repairPrompt)).object, selection);
    const remaining = validateProse(repaired, selection, cap);
    if (remaining.length === 0) return { prose: repaired, source: "repaired", errors };
    return { prose: fallbackProse(selection), source: "fallback", errors: remaining };
  } catch (error) {
    console.warn(`compose repair failed: ${error instanceof Error ? error.message : String(error)}`);
    return { prose: fallbackProse(selection), source: "fallback", errors };
  }
}

export async function composeProse(selection: BriefSelection): Promise<BriefProse> {
  return (await composeBrief(selection)).prose;
}
