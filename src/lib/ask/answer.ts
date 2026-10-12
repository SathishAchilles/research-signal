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

// arxivId, urlAbs and authors (first few names) give a client-safe source link; answers saved before
// they existed lack them, so readers fall back to the paper's figure record or leave the link out.
export type AskCitation = {
  ref: string;
  paperId: string;
  title: string;
  rung: string | null;
  arxivId?: string | null;
  urlAbs?: string | null;
  authors?: string[];
};
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

// ---------------------------------------------------------------------------------------------
// Rendering helpers for finished answers: a small Markdown block parser, inline tokens and the
// client note export. Pure, so the panel maps them to JSX and scripts can check them directly.

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: InlineToken[] }
  | { kind: "italic"; children: InlineToken[] }
  | { kind: "code"; text: string }
  | { kind: "math"; parts: MathPart[] }
  | { kind: "cite"; ref: string }
  // 4+ adjacent citations: the first three are shown, the rest are counted in a "+N" chip.
  | { kind: "citeRun"; shown: string[]; hidden: string[] };

export type MathPart = { kind: "text" | "sub" | "sup"; text: string };

export type ListItem = { text: string; children: ListBlock | null };
export type ListBlock = { type: "list"; ordered: boolean; start: number; items: ListItem[] };
export type Block =
  | { type: "hr" }
  | { type: "heading"; level: number; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | ListBlock
  | { type: "note"; text: string }
  | { type: "p"; text: string };

export const CITE_RUN_SHOWN = 3;
const CITE_RUN_MIN = 4;

const MATH_SYMBOLS: Record<string, string> = {
  times: "×", cdot: "·", le: "≤", leq: "≤", ge: "≥", geq: "≥", approx: "≈", pm: "±", sim: "~",
  rightarrow: "→", to: "→", infty: "∞", alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  theta: "θ", lambda: "λ", mu: "μ", sigma: "σ", tau: "τ", rho: "ρ", pi: "π", ell: "ℓ", "%": "%",
};

// Inline LaTeX ("SegF_1", "^2", "\times") as text runs with subscripts and superscripts.
export function mathParts(source: string): MathPart[] {
  const src = source
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname|textbf|mathcal)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\([a-zA-Z]+|%)/g, (match, name: string) => MATH_SYMBOLS[name] ?? (name.length > 1 ? name : match))
    .replace(/\\[,;:! ]/g, " ");
  const parts: MathPart[] = [];
  const push = (kind: MathPart["kind"], text: string) => {
    const clean = text.replace(/[{}]/g, "");
    if (!clean) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += clean;
    else parts.push({ kind, text: clean });
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if ((ch === "_" || ch === "^") && i + 1 < src.length) {
      const kind = ch === "_" ? "sub" : "sup";
      if (src[i + 1] === "{") {
        const end = src.indexOf("}", i + 2);
        const stop = end === -1 ? src.length : end;
        push(kind, src.slice(i + 2, stop));
        i = stop;
      } else {
        push(kind, src[i + 1]);
        i += 1;
      }
      continue;
    }
    push("text", ch);
  }
  return parts;
}

// Plain-text form of inline math for the client note: subscripts run on, superscripts keep a caret.
export function mathPlain(source: string): string {
  return mathParts(source)
    .map((p) => (p.kind === "sup" ? `^${p.text}` : p.text))
    .join("");
}

// $…$ needs a non-space just inside each dollar and no digit after the closing one, so "$5 to $10"
// stays prose.
const MATH = /\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/g;

export function stripMath(text: string): string {
  return text.replace(MATH, (_m, body: string) => mathPlain(body));
}

const INLINE = new RegExp(
  [
    /`[^`\n]+`/.source,
    MATH.source,
    /\[p\d+\](?:[\s,]*\[p\d+\]){3,}/.source,
    /\[p\d+\]/.source,
    /\*\*[^*\n]+?\*\*/.source,
    /(?<![*\w])\*(?![\s*])[^*\n]+?(?<![\s*])\*(?![*\w])/.source,
    /(?<![\w])_(?![\s_])[^_\n]+?(?<![\s_])_(?![\w])/.source,
  ].join("|"),
  "g",
);

export function inlineTokens(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    const token = match[0];
    if (index > last) out.push({ kind: "text", text: text.slice(last, index) });
    if (token.startsWith("`")) out.push({ kind: "code", text: token.slice(1, -1) });
    else if (token.startsWith("$")) out.push({ kind: "math", parts: mathParts(token.slice(1, -1)) });
    else if (token.startsWith("[p")) {
      const refs = [...token.matchAll(CITATION)].map((m) => m[1]);
      if (refs.length >= CITE_RUN_MIN) {
        out.push({ kind: "citeRun", shown: refs.slice(0, CITE_RUN_SHOWN), hidden: refs.slice(CITE_RUN_SHOWN) });
      } else out.push({ kind: "cite", ref: refs[0] });
    } else if (token.startsWith("**")) out.push({ kind: "bold", children: inlineTokens(token.slice(2, -2)) });
    else out.push({ kind: "italic", children: inlineTokens(token.slice(1, -1)) });
    last = index + token.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

// A line that only restates the confidence ("**Confidence:** Medium"); the badge already shows it.
// The BET verdict line ("**Verdict: Watch** · Confidence: Medium") is not matched.
const CONFIDENCE_LINE = /^\s*(?:[-*]\s+)?[*_]*\s*Confidence\s*[*_]*\s*:\s*[*_]*\s*(?:High|Medium|Low)\b[\s*_.]*$/i;

export function dropConfidenceLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !CONFIDENCE_LINE.test(line))
    .join("\n");
}

const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const NOTE = /^_(.+)_$/;

type ListLine = { indent: number; ordered: boolean; number: number; text: string };

function listLine(line: string): ListLine | null {
  if (HR.test(line)) return null;
  const m = line.match(LIST_ITEM);
  if (!m) return null;
  const ordered = /\d/.test(m[2]);
  return { indent: m[1].replace(/\t/g, "  ").length, ordered, number: ordered ? Number.parseInt(m[2], 10) : 1, text: m[3] };
}

function newList(first: ListLine): ListBlock {
  return { type: "list", ordered: first.ordered, start: first.number, items: [] };
}

// Consecutive items of one kind form one list; a blank line between items keeps the list open, and
// deeper-indented items nest one level under the item above them.
function parseList(lines: string[], from: number): { block: ListBlock; next: number } {
  const first = listLine(lines[from])!;
  const block = newList(first);
  const base = first.indent;
  let i = from;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const peek = j < lines.length ? listLine(lines[j]) : null;
      if (!peek || (peek.indent <= base + 1 && peek.ordered !== block.ordered)) break;
      i = j;
      continue;
    }
    const item = listLine(line);
    const lastItem = block.items[block.items.length - 1];
    if (item && item.indent <= base + 1) {
      if (item.ordered !== block.ordered) break;
      block.items.push({ text: item.text, children: null });
    } else if (item && lastItem) {
      lastItem.children ??= newList(item);
      lastItem.children.items.push({ text: item.text, children: null });
    } else if (!item && lastItem && /^\s{2,}\S/.test(line)) {
      const target = lastItem.children?.items[lastItem.children.items.length - 1] ?? lastItem;
      target.text += ` ${line.trim()}`;
    } else break;
    i++;
  }
  return { block, next: i };
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (HR.test(line)) {
      // Back-to-back rules (or one at the very top) add nothing.
      if (blocks.length && blocks[blocks.length - 1].type !== "hr") blocks.push({ type: "hr" });
      i++;
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head = [], ...body] = rows;
      blocks.push({ type: "table", head, rows: body });
      continue;
    }
    if (listLine(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }
    const note = line.trim().match(NOTE);
    if (note) blocks.push({ type: "note", text: note[1] });
    else blocks.push({ type: "p", text: line.trim() });
    i++;
  }
  while (blocks.length && blocks[blocks.length - 1].type === "hr") blocks.pop();
  return blocks;
}

// Where a cited paper can be read outside the app: arXiv first, then the source's own page. Never
// the app's /paper/<uuid> page, which a client cannot open.
export function publicPaperUrl(c: { arxivId?: string | null; urlAbs?: string | null }): string | null {
  if (c.arxivId) return `https://arxiv.org/abs/${c.arxivId}`;
  if (c.urlAbs && /^https?:\/\//.test(c.urlAbs)) return c.urlAbs;
  return null;
}

export type PaperFallback = { arxivId?: string | null; authors?: string[] };

// The answer as a client note: [pN] refs become [N] footnotes in order of first use, inline math
// loses its dollars, and the confidence appears once, in the header.
export function asClientMarkdown(input: {
  title: string;
  text: string;
  confidence?: string | null;
  coverageLine?: string | null;
  citations: AskCitation[];
  fallback?: Record<string, PaperFallback | undefined>;
}): string {
  let body = input.text;
  if (input.confidence) {
    body = dropConfidenceLines(body).replace(/(\*\*Verdict:[^\n]*?)\s*·\s*Confidence:\s*(?:High|Medium|Low)\b/i, "$1");
  }
  const byRef = new Map(input.citations.map((c) => [c.ref, c]));
  const order = [...new Set([...citedRefs(body).filter((ref) => byRef.has(ref)), ...input.citations.map((c) => c.ref)])];
  const number = new Map(order.map((ref, i) => [ref, i + 1]));
  body = stripMath(body)
    .replace(CITATION, (match, ref: string) => (number.has(ref) ? `[${number.get(ref)}]` : match))
    .replace(/\n\s*\n(?:\s*\n)+/g, "\n\n");

  const sources = order.map((ref) => {
    const c = byRef.get(ref)!;
    const fallback = input.fallback?.[c.paperId];
    const authors = c.authors?.length ? c.authors : (fallback?.authors ?? []);
    const byline = authors[0] ? `, ${authors[0]}${authors.length > 1 ? " et al." : ""}` : "";
    const url = publicPaperUrl({ arxivId: c.arxivId ?? fallback?.arxivId, urlAbs: c.urlAbs });
    return `- [${number.get(ref)}] ${stripMath(c.title)}${byline} (${c.rung ?? "LAB"})${url ? `: ${url}` : ""}`;
  });

  return [
    `# ${stripMath(input.title)}`,
    "",
    input.confidence ? `Confidence: ${input.confidence}` : "",
    input.coverageLine ?? "",
    "",
    body.trim(),
    "",
    sources.length ? "## Sources" : "",
    ...sources,
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n")
    .trim()
    .concat("\n");
}
