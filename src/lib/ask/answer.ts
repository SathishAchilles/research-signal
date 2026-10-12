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

// The BET verdict line carries the code-computed confidence, whatever the model wrote after the verdict.
export function withVerdictConfidence(text: string, confidence: string): string {
  return text.replace(
    /^[ \t]*[*_]*\s*Verdict:\s*[*_]*\s*(Bet|Pilot|Watch|Avoid)\b[^\n]*/im,
    (_line, verdict: string) => `**Verdict: ${verdict}** · Confidence: ${confidence}`,
  );
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function coverageLine(c: Omit<AskCoverage, "line">): string {
  const range = c.from && c.to ? ` ${c.from} – ${c.to}` : "";
  const live = c.live.used ? ` + live HF (${c.live.found} found)` : "";
  return `Searched ${c.indexed} indexed papers${range}${live}`;
}

const NUMBER = /\d+(?:[.,]\d+)*/g;

// "1,470" and "1470", "03" and "3" are the same number.
function canonical(number: string): string {
  const plain = number.replace(/,(?=\d{3}\b)/g, "");
  return /^\d+$/.test(plain) ? String(Number(plain)) : plain;
}

function numbersIn(text: string): Set<string> {
  return new Set([...text.matchAll(NUMBER)].map((m) => canonical(m[0])));
}

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];
const NUMBER_WORD = new RegExp(`\\b(${NUMBER_WORDS.join("|")})\\b`, "gi");

// Numbers in source text, including spelled-out ones ("fifteen models" allows "15 models").
function sourceNumbers(text: string): Set<string> {
  const found = numbersIn(text);
  for (const [word] of text.matchAll(NUMBER_WORD)) found.add(String(NUMBER_WORDS.indexOf(word.toLowerCase())));
  return found;
}

// Ordered-list markers ("1. ") and table separator rows carry no claim.
function claimText(text: string): string {
  return text
    .replace(TOKEN, " ")
    .replace(CITATION, " ")
    .replace(/^\s*\d+[.)]\s+/gm, " ");
}

// Checks adapted from the brief validator: banned words, word cap, known citations, evidence tokens
// that resolve, and numbers. A number is accepted only when it is an evidence-token value of a known
// paper, appears in a tool's output about a paper the answer cites, or appears in `context` (the
// prompt, the template, the dates of the question and paper-independent tool output such as trend weeks).
export function validateAnswer(
  text: string,
  options: {
    knownRefs: Set<string>;
    evidence: AskEvidence;
    paperData: Record<string, string>;
    context: string;
    wordCap: number;
  },
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

  const allowed = sourceNumbers(options.context);
  for (const fields of Object.values(options.evidence)) {
    for (const value of Object.values(fields)) {
      if (typeof value === "number") {
        allowed.add(canonical(String(value)));
        for (const n of numbersIn(formatCount(value))) allowed.add(n);
      }
    }
  }
  for (const ref of cited) {
    for (const n of sourceNumbers(options.paperData[ref] ?? "")) allowed.add(n);
  }
  const unknown = [...numbersIn(claimText(text))].filter((n) => !allowed.has(n));
  if (unknown.length > 0) {
    errors.push(`Numbers not found in the cited papers or the question: ${unknown.slice(0, 10).join(", ")}`);
  }
  return errors;
}
