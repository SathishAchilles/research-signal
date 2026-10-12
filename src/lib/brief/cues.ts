import { formatCount } from "./tokens";
import type { BriefCard } from "./types";

// Text and color cues shared by the email and the web brief. Every cue is readable as text alone.
export const COLORS = {
  ink: "#1A1D21",
  muted: "#5B6169",
  rule: "#D9DCE1",
  rising: "#007A5E",
  verdict: { CLIENT: "#D55E00", READ: "#0072B2", SKIP: "#8A8F98" },
} as const;

export const VERDICT_LABEL = { CLIENT: "BRING TO CLIENT", READ: "READ", SKIP: "SKIP" } as const;
export const RUNG_LEVEL = { LAB: 1, CODE: 2, MODEL: 3, PEER: 4 } as const;
export const SIGNAL_BORDER = { BENCH: "solid", EVAL: "dashed", REFRAME: "dotted", METHOD: "double" } as const;
export const meterText = (rung: BriefCard["rung"]) =>
  `[${"#".repeat(RUNG_LEVEL[rung])}${"-".repeat(4 - RUNG_LEVEL[rung])}] ${rung}`;

export function attentionText(card: Pick<BriefCard, "evidence">): string {
  const e = card.evidence;
  const parts: string[] = [];
  if (e.hf_upvotes != null) parts.push(`HF ${formatCount(e.hf_upvotes)} upvotes`);
  if (e.github_stars != null) parts.push(`${formatCount(e.github_stars)} stars`);
  if (e.linked) parts.push(`${formatCount(e.linked)} models/Spaces`);
  if (e.s2_citations != null) parts.push(`${formatCount(e.s2_citations)} citations`);
  return parts.join(" · ") || "No attention signals yet";
}
