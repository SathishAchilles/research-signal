import { z } from "zod";
import type { Rung, SignalType, Verdict } from "@/lib/pipeline/rank";

export type Tier = "HERO" | "STANDARD" | "COMPACT" | "RISING";
export type ActionKind = "READ" | "CLIENT" | "SKIP";

// Numeric evidence per card; prose may only reference these through {{ev:<cardId>.<field>}} tokens.
export const EVIDENCE_FIELDS = [
  "hf_upvotes",
  "hf_comments",
  "github_stars",
  "linked",
  "s2_citations",
  "rising_pct",
  "final_score",
] as const;
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];
export type Evidence = Partial<Record<EvidenceField, number | null>>;

export type BriefCard = {
  cardId: string;
  paperId: string;
  arxivId: string | null;
  domainId: number;
  tier: Tier;
  inTop3: boolean;
  title: string;
  abstract: string;
  status: string;
  final: number;
  verdict: Verdict;
  rung: Rung;
  signalType: SignalType;
  novelty: number;
  llmRelevance: number;
  cosine: number;
  clientAngle: string;
  links: { abs: string | null; pdf: string | null; code: string | null; hf: string | null };
  evidence: Evidence;
};

export type QuietMiss = { paperId: string; title: string; final: number } | null;

export type DomainSelection = {
  domainId: number;
  name: string;
  slug: string;
  hero: string | null;
  standard: string[];
  compact: string[];
  quiet: boolean;
  nearestMiss: QuietMiss;
};

export type SourceHealth = { kind: string; status: "PARTIAL" | "FAILED"; note: string };

export type BriefSelection = {
  isoWeek: string;
  windowStart: string;
  windowEnd: string;
  label: string;
  cards: Record<string, BriefCard>;
  top3: string[];
  domains: DomainSelection[];
  rising: string[];
  sourceHealth: SourceHealth[];
};

export const BriefProse = z.object({
  weekLine: z.string(),
  top3: z.array(z.object({ cardId: z.string(), pointer: z.string(), evidenceRefs: z.array(z.string()) })),
  domains: z.array(
    z.object({
      domainId: z.number().int(),
      situation: z.string(),
      complication: z.string(),
      implication: z.string(),
      cards: z.array(
        z.object({
          cardId: z.string(),
          headline: z.string(),
          lede: z.string().optional(),
          clientAngle: z.string(),
          verdictReason: z.string(),
          evidenceRefs: z.array(z.string()),
        }),
      ),
    }),
  ),
  rising: z.array(z.object({ cardId: z.string(), line: z.string(), evidenceRefs: z.array(z.string()) })),
});
export type BriefProse = z.infer<typeof BriefProse>;

// What briefs.json stores and both the email and the web page render. Prose has tokens filled.
export type BriefDoc = {
  version: 1;
  briefId: string;
  generatedAt: string;
  proseSource: "llm" | "repaired" | "fallback";
  selection: BriefSelection;
  prose: BriefProse;
};

export const domainSlug = (domainId: number) => `d${domainId}`;
