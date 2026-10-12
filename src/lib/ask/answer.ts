// Pure helpers shared by the Ask route and the Ask panel; no server imports.

export const BANNED_WORDS = [
  "revolutionary",
  "groundbreaking",
  "game-changer",
  "unprecedented",
  "paradigm shift",
  "cutting-edge",
  "unlock",
  "supercharge",
  "delve",
  "landscape",
];

export const TOKEN = /\{\{ev:(p\d+)\.([a-z]+)\}\}/g;
export const CITATION = /\[(p\d+)\]/g;

export type AskCitation = { ref: string; paperId: string; title: string; rung: string | null };
export type AskEvidence = Record<string, Record<string, number | null | undefined>>;

export type AskCoverage = {
  indexed: number;
  from: string | null;
  to: string | null;
  live: { used: boolean; found: number };
  line: string;
};

export type AskMetadata = {
  threadId: string;
  messageId: string;
  intent: string;
  confidence?: "High" | "Medium" | "Low";
  coverage?: AskCoverage;
  citations?: AskCitation[];
  evidence?: AskEvidence;
};

export function citedRefs(text: string): string[] {
  return [...new Set([...text.matchAll(CITATION)].map((m) => m[1]))];
}

export function formatCount(value: number): string {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

export function fillEvidenceTokens(text: string, evidence: AskEvidence): string {
  return text.replace(TOKEN, (_match, ref: string, field: string) => {
    const value = evidence[ref]?.[field];
    return typeof value === "number" ? formatCount(value) : "n/a";
  });
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function coverageLine(c: Omit<AskCoverage, "line">): string {
  const range = c.from && c.to ? ` ${c.from} – ${c.to}` : "";
  const live = c.live.used ? ` + live HF (${c.live.found} found)` : "";
  return `Searched ${c.indexed} indexed papers${range}${live}`;
}

// Checks adapted from the brief validator: banned words, word cap, known citations,
// evidence tokens that resolve, and numbers that appear in retrieved data or the prompt.
export function validateAnswer(
  text: string,
  options: { knownRefs: Set<string>; evidence: AskEvidence; retrieved: string; prompt: string; wordCap: number },
): string[] {
  const errors: string[] = [];
  const lower = text.toLowerCase();
  for (const word of BANNED_WORDS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(lower)) errors.push(`Banned word "${word}"`);
  }
  const words = wordCount(text);
  if (words > options.wordCap) errors.push(`Answer has ${words} words; the cap is ${options.wordCap}`);

  const cited = citedRefs(text);
  if (cited.length === 0 && options.knownRefs.size > 0) errors.push("The answer cites no papers");
  for (const ref of cited) {
    if (!options.knownRefs.has(ref)) errors.push(`Citation [${ref}] was not returned by any tool`);
  }

  for (const [, ref, field] of text.matchAll(TOKEN)) {
    if (!options.knownRefs.has(ref)) errors.push(`Token {{ev:${ref}.${field}}} uses an unknown ref`);
    else if (typeof options.evidence[ref]?.[field] !== "number") {
      errors.push(`Token {{ev:${ref}.${field}}} has no value`);
    }
  }

  const stripped = text.replace(TOKEN, " ").replace(CITATION, " ");
  const haystack = `${options.retrieved}\n${options.prompt}`;
  const unknown = new Set<string>();
  for (const [number] of stripped.matchAll(/\d+(?:[.,]\d+)*/g)) {
    if (!haystack.includes(number)) unknown.add(number);
  }
  if (unknown.size > 0) {
    errors.push(`Numbers not found in retrieved data: ${[...unknown].slice(0, 10).join(", ")}`);
  }
  return errors;
}
