import type { Rung } from "@/lib/pipeline/rank";

export type Confidence = "High" | "Medium" | "Low";

const AT_LEAST_CODE: ReadonlySet<Rung> = new Set(["CODE", "MODEL", "PEER"]);

// High: >= 5 papers at rung >= CODE including >= 1 PEER. Medium: >= 3 papers. Low otherwise.
export function confidence(papers: { rung: Rung | null }[]): Confidence {
  const strong = papers.filter((p) => p.rung !== null && AT_LEAST_CODE.has(p.rung)).length;
  const peer = papers.filter((p) => p.rung === "PEER").length;
  if (strong >= 5 && peer >= 1) return "High";
  if (papers.length >= 3) return "Medium";
  return "Low";
}

export const THIN_EVIDENCE = "Thin evidence: fewer than three relevant papers were found.";
