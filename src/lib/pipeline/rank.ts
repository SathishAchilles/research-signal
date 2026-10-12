import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings, type rung as rungEnum, type signalType as signalTypeEnum, type verdict as verdictEnum } from "@/db/schema";
import { enqueue } from "./jobs";

export type SignalType = (typeof signalTypeEnum.enumValues)[number];
export type Rung = (typeof rungEnum.enumValues)[number];
export type Verdict = (typeof verdictEnum.enumValues)[number];

export type Weights = { relevance: number; significance: number; attention: number; validation: number };
export type Thresholds = { client: number; read: number };

export const DEFAULT_WEIGHTS: Weights = { relevance: 0.35, significance: 0.3, attention: 0.2, validation: 0.15 };
export const DEFAULT_THRESHOLDS: Thresholds = { client: 0.7, read: 0.5 };

export const RUNG_ORDER: readonly Rung[] = ["LAB", "CODE", "MODEL", "PEER"];
const RUNG_VALUE: Record<Rung, number> = { LAB: 0, CODE: 0.33, MODEL: 0.66, PEER: 1 };
const TYPE_WEIGHT: Record<SignalType, number> = { BENCH: 1, EVAL: 1, REFRAME: 0.9, METHOD: 0.6 };

export const FINALISTS_PER_DOMAIN = 10;
export const RANK_WINDOW_DAYS = 28;

export type ScoreInput = {
  cosine: number;
  llmRelevance: number;
  novelty: number;
  signalType: SignalType;
  upvotes: number;
  stars: number;
  linked: number;
  rung: Rung;
};

const capped = (x: number) => Math.min(1, Math.max(0, x));

export function scoreComponents(input: ScoreInput) {
  return {
    relevance: 0.5 * input.cosine + 0.5 * (input.llmRelevance / 5),
    significance: 0.6 * (input.novelty / 5) + 0.4 * TYPE_WEIGHT[input.signalType],
    attention:
      0.5 * capped(Math.log10(1 + Math.max(0, input.upvotes)) / 2.5) +
      0.3 * capped(Math.log10(1 + Math.max(0, input.stars)) / 4) +
      0.2 * capped(input.linked / 5),
    validation: RUNG_VALUE[input.rung],
  };
}

export function finalScore(input: ScoreInput, weights: Weights = DEFAULT_WEIGHTS): number {
  const c = scoreComponents(input);
  return (
    weights.relevance * c.relevance +
    weights.significance * c.significance +
    weights.attention * c.attention +
    weights.validation * c.validation
  );
}

export function verdictFor(final: number, rung: Rung, thresholds: Thresholds = DEFAULT_THRESHOLDS): Verdict {
  if (final >= thresholds.client && RUNG_ORDER.indexOf(rung) >= RUNG_ORDER.indexOf("CODE")) return "CLIENT";
  if (final >= thresholds.read) return "READ";
  return "SKIP";
}

function pick<T extends Record<string, number>>(defaults: T, stored: Record<string, number> | undefined): T {
  const out = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = stored?.[key as string];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value as T[keyof T];
  }
  return out;
}

export async function loadRankSettings(): Promise<{ weights: Weights; thresholds: Thresholds }> {
  const [row] = await db
    .select({ weights: appSettings.weights, thresholds: appSettings.thresholds })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  return { weights: pick(DEFAULT_WEIGHTS, row?.weights), thresholds: pick(DEFAULT_THRESHOLDS, row?.thresholds) };
}

const scoredInWindow = sql`pd.llm_relevance is not null and pd.novelty is not null and pd.signal_type is not null
  and p.status in ('SCORED', 'FINALIST', 'SENT')
  and coalesce(p.announced_at, p.submitted_at, p.created_at) >= now() - make_interval(days => ${RANK_WINDOW_DAYS})`;

type RankRow = {
  paper_id: string;
  domain_id: number;
  status: string;
  cosine: number | null;
  llm_relevance: number;
  novelty: number;
  signal_type: SignalType;
  rung: Rung | null;
  upvotes: number;
  stars: number;
  linked: number;
};

export type RankResult = { ranked: number; promoted: number; demoted: number };

type CapRow = { paper_id: string; domain_id: number; status: string; final: number };

// Greedy by final: a paper is kept or promoted only while every domain it belongs to has room, and it
// then counts once against each of them. SENT papers are never selected and never take a slot.
export function selectFinalists(rows: CapRow[], cap = FINALISTS_PER_DOMAIN): Set<string> {
  const domainsOf = new Map<string, number[]>();
  for (const r of rows) domainsOf.set(r.paper_id, [...(domainsOf.get(r.paper_id) ?? []), r.domain_id]);
  const counts = new Map<number, number>();
  const selected = new Set<string>();
  const order = [...rows].sort((a, b) => b.final - a.final || a.paper_id.localeCompare(b.paper_id));
  for (const r of order) {
    if (r.status === "SENT" || selected.has(r.paper_id)) continue;
    const linked = domainsOf.get(r.paper_id) ?? [];
    if (linked.some((d) => (counts.get(d) ?? 0) >= cap)) continue;
    selected.add(r.paper_id);
    for (const d of linked) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return selected;
}

// Recomputes final_score and verdict for scored rows from the last RANK_WINDOW_DAYS, then keeps at most
// FINALISTS_PER_DOMAIN FINALIST papers per domain in that window: the best SCORED papers are promoted
// and FINALISTs that no longer fit are demoted to SCORED. Their signals stay, so enrichment is not lost.
export async function rankAll(domainIds?: number[]): Promise<RankResult> {
  if (domainIds && domainIds.length === 0) return { ranked: 0, promoted: 0, demoted: 0 };
  const { weights, thresholds } = await loadRankSettings();
  const rows = await db.execute<RankRow>(sql`
    select pd.paper_id, pd.domain_id, p.status,
      pd.cosine, pd.llm_relevance, pd.novelty, pd.signal_type, e.rung,
      coalesce(e.hf_upvotes, 0)::int as upvotes,
      coalesce(e.github_stars, 0)::int as stars,
      (coalesce(e.linked_models, 0) + coalesce(e.linked_spaces, 0))::int as linked
    from research_signal.paper_domain pd
    join research_signal.papers p on p.id = pd.paper_id
    left join research_signal.evidence e on e.paper_id = p.id
    where ${scoredInWindow}
      ${domainIds ? sql`and pd.domain_id in ${domainIds}` : sql``}`);
  if (rows.length === 0) return { ranked: 0, promoted: 0, demoted: 0 };

  const ranked = rows.map((r) => {
    const rung = r.rung ?? "LAB";
    const final = finalScore(
      {
        cosine: Number(r.cosine ?? 0),
        llmRelevance: Number(r.llm_relevance),
        novelty: Number(r.novelty),
        signalType: r.signal_type,
        upvotes: Number(r.upvotes),
        stars: Number(r.stars),
        linked: Number(r.linked),
        rung,
      },
      weights,
    );
    return { ...r, final, verdict: verdictFor(final, rung, thresholds) };
  });

  for (let i = 0; i < ranked.length; i += 500) {
    const chunk = ranked
      .slice(i, i + 500)
      .map((r) => ({ paper_id: r.paper_id, domain_id: Number(r.domain_id), final_score: r.final, verdict: r.verdict }));
    await db.execute(sql`
      update research_signal.paper_domain pd
      set final_score = r.final_score, verdict = r.verdict::research_signal.verdict
      from jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb)
        as r(paper_id uuid, domain_id int, final_score real, verdict text)
      where pd.paper_id = r.paper_id and pd.domain_id = r.domain_id`);
  }

  // The cap is checked over every domain in the window, so a paper's other domains are seen even when
  // only some domains were re-ranked.
  const window = await db.execute<CapRow>(sql`
    select pd.paper_id, pd.domain_id, p.status, pd.final_score as final
    from research_signal.paper_domain pd
    join research_signal.papers p on p.id = pd.paper_id
    where ${scoredInWindow} and pd.final_score is not null`);
  const selected = selectFinalists(window.map((r) => ({ ...r, domain_id: Number(r.domain_id), final: Number(r.final) })));
  const promote = [...new Set(window.filter((r) => r.status === "SCORED" && selected.has(r.paper_id)).map((r) => r.paper_id))];
  const demote = [...new Set(window.filter((r) => r.status === "FINALIST" && !selected.has(r.paper_id)).map((r) => r.paper_id))];

  let demoted = 0;
  if (demote.length > 0) {
    const updated = await db.execute(sql`
      update research_signal.papers set status = 'SCORED'
      where id in ${demote} and status = 'FINALIST'
      returning id`);
    demoted = updated.length;
  }
  let promoted = 0;
  if (promote.length > 0) {
    const updated = await db.execute(sql`
      update research_signal.papers set status = 'FINALIST'
      where id in ${promote} and status = 'SCORED'
      returning id`);
    promoted = updated.length;
    if (promoted > 0) await enqueue("enrich");
  }
  return { ranked: ranked.length, promoted, demoted };
}
