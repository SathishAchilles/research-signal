import { TOKEN_PATTERN } from "./tokens";
import type { BriefProse, BriefSelection } from "./types";
import { EVIDENCE_FIELDS } from "./types";

export const WORD_CAPS = {
  weekLine: 25,
  pointer: 30,
  intro: 40,
  headline: 10,
  lede: 22,
  clientAngle: 18,
  verdictReason: 12,
  rising: 18,
} as const;
export const TOTAL_WORD_CAP = 1500;

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

// A token counts as one word.
export function wordCount(text: string | undefined): number {
  if (!text) return 0;
  return text.replace(TOKEN_PATTERN, "N").split(/\s+/).filter(Boolean).length;
}

const withoutTokens = (text: string) => text.replace(TOKEN_PATTERN, " ");

function bannedIn(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_WORDS.filter((word) => new RegExp(`\\b${word.replace(/[-\s]/g, "[-\\s]?")}`, "i").test(lower));
}

export function proseTexts(prose: BriefProse): string[] {
  return [
    prose.weekLine,
    ...prose.top3.map((t) => t.pointer),
    ...prose.domains.flatMap((d) => [
      d.situation,
      d.complication,
      d.implication,
      ...d.cards.flatMap((c) => [c.headline, c.lede ?? "", c.clientAngle, c.verdictReason]),
    ]),
    ...prose.rising.map((r) => r.line),
  ];
}

export const totalWords = (prose: BriefProse) => proseTexts(prose).reduce((sum, t) => sum + wordCount(t), 0);

// Returns every rule the prose breaks; an empty list means it can be delivered.
export function validateProse(prose: BriefProse, selection: BriefSelection, totalCap = TOTAL_WORD_CAP): string[] {
  const errors: string[] = [];
  const cap = (where: string, text: string | undefined, max: number) => {
    const n = wordCount(text);
    if (n > max) errors.push(`${where}: ${n} words, cap is ${max}`);
  };
  const check = (where: string, text: string | undefined) => {
    if (!text) return;
    if (/\d/.test(withoutTokens(text))) errors.push(`${where}: digit outside an evidence token`);
    for (const word of bannedIn(text)) errors.push(`${where}: banned word "${word}"`);
    for (const match of text.matchAll(TOKEN_PATTERN)) {
      if (!selection.cards[match[1]]) errors.push(`${where}: token names unknown card ${match[1]}`);
      else if (!(EVIDENCE_FIELDS as readonly string[]).includes(match[2])) {
        errors.push(`${where}: token names unknown field ${match[2]}`);
      }
    }
  };
  // Each ref is `<cardId>.<field>` naming a card in this selection and a known evidence field.
  const refs = (where: string, list: string[]) => {
    if (list.length === 0) errors.push(`${where}: evidenceRefs is empty`);
    for (const ref of list) {
      const match = /^([A-Za-z0-9_-]+)\.([a-z0-9_]+)$/.exec(ref.trim());
      if (!match) errors.push(`${where}: evidenceRef "${ref}" is not <cardId>.<field>`);
      else if (!selection.cards[match[1]]) errors.push(`${where}: evidenceRef names unknown card ${match[1]}`);
      else if (!(EVIDENCE_FIELDS as readonly string[]).includes(match[2])) {
        errors.push(`${where}: evidenceRef names unknown field ${match[2]}`);
      }
    }
  };

  cap("weekLine", prose.weekLine, WORD_CAPS.weekLine);
  check("weekLine", prose.weekLine);
  for (const t of prose.top3) {
    cap(`top3 ${t.cardId} pointer`, t.pointer, WORD_CAPS.pointer);
    check(`top3 ${t.cardId} pointer`, t.pointer);
    refs(`top3 ${t.cardId}`, t.evidenceRefs);
  }
  for (const d of prose.domains) {
    const where = `domain ${d.domainId}`;
    const intro = [d.situation, d.complication, d.implication];
    const n = intro.reduce((sum, t) => sum + wordCount(t), 0);
    if (n > WORD_CAPS.intro) errors.push(`${where} situation+complication+implication: ${n} words, cap is ${WORD_CAPS.intro}`);
    intro.forEach((t) => check(where, t));
    for (const c of d.cards) {
      const at = `${where} card ${c.cardId}`;
      cap(`${at} headline`, c.headline, WORD_CAPS.headline);
      cap(`${at} lede`, c.lede, WORD_CAPS.lede);
      cap(`${at} clientAngle`, c.clientAngle, WORD_CAPS.clientAngle);
      cap(`${at} verdictReason`, c.verdictReason, WORD_CAPS.verdictReason);
      [c.headline, c.lede, c.clientAngle, c.verdictReason].forEach((t) => check(at, t));
      refs(at, c.evidenceRefs);
      if (!selection.cards[c.cardId]) errors.push(`${at}: unknown card`);
    }
  }
  for (const r of prose.rising) {
    cap(`rising ${r.cardId}`, r.line, WORD_CAPS.rising);
    check(`rising ${r.cardId}`, r.line);
    refs(`rising ${r.cardId}`, r.evidenceRefs);
  }

  const total = totalWords(prose);
  if (total > totalCap) errors.push(`total prose: ${total} words, cap is ${totalCap}`);
  return errors;
}
