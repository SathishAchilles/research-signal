import type { Evidence } from "./types";

export const TOKEN_PATTERN = /\{\{\s*ev:([A-Za-z0-9_-]+)\.([a-z0-9_]+)\s*\}\}/g;

export function formatCount(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(n / 1_000)}k`;
  return String(Math.round(n));
}

const trim = (n: number) => (Math.abs(n) >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ""));

export function formatPercent(n: number): string {
  const rounded = Math.round(n);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

export function formatEvidence(field: string, value: number): string {
  if (field.endsWith("_pct")) return formatPercent(value);
  if (field === "final_score") return value.toFixed(2);
  return formatCount(value);
}

// Replaces {{ev:p3.hf_upvotes}} tokens with formatted stored values; unknown tokens become "n/a".
export function fillTokens(text: string, evidence: Record<string, Evidence>): string {
  return text.replace(TOKEN_PATTERN, (_match, cardId: string, field: string) => {
    const value = (evidence[cardId] as Record<string, number | null | undefined> | undefined)?.[field];
    return typeof value === "number" && Number.isFinite(value) ? formatEvidence(field, value) : "n/a";
  });
}
