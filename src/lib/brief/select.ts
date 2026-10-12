import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import type { Rung, SignalType, Verdict } from "@/lib/pipeline/rank";
import type { BriefCard, BriefSelection, DomainSelection, Evidence, RerankOverrides, SourceHealth, Tier } from "./types";
import { domainSlug, overrideKey } from "./types";
import type { BriefWindow } from "./window";

export type { BriefSelection } from "./types";

export type TierThresholds = { hero: number; standard: number; compact: number };
export const DEFAULT_TIER_THRESHOLDS: TierThresholds = { hero: 0.6, standard: 0.5, compact: 0.4 };
export const TIER_CAPS = { hero: 1, standard: 2, compact: 5 } as const;
export const TOP3_SIZE = 3;
export const RISING_CAP = 6;
const RISING_LOOKBACK_WEEKS = 8;

type Row = {
  paper_id: string;
  domain_id: number;
  arxiv_id: string | null;
  title: string;
  abstract: string;
  status: string;
  url_abs: string | null;
  url_pdf: string | null;
  final_score: number;
  verdict: Verdict | null;
  cosine: number | null;
  llm_relevance: number | null;
  novelty: number | null;
  signal_type: SignalType | null;
  client_angle: string | null;
  rung: Rung | null;
  hf_upvotes: number | null;
  hf_comments: number | null;
  github_repo: string | null;
  github_stars: number | null;
  linked: number | null;
  s2_citations: number | null;
  prev_upvotes: number | null;
  sent_before: boolean;
  rising: boolean;
};

const evidenceColumns = sql.raw(`
  p.id as paper_id, pd.domain_id, p.arxiv_id, p.title, p.abstract, p.status::text as status,
  p.url_abs, p.url_pdf, pd.final_score, pd.verdict, pd.cosine, pd.llm_relevance, pd.novelty,
  pd.signal_type, pd.client_angle, e.rung, e.rising, e.hf_upvotes, e.hf_comments, e.github_repo,
  e.github_stars, (coalesce(e.linked_models, 0) + coalesce(e.linked_spaces, 0))::int as linked,
  e.s2_citations, prev.hf_upvotes as prev_upvotes`);

const previousSnapshot = sql.raw(`
  left join lateral (
    select s.hf_upvotes from research_signal.signals s
    where s.paper_id = p.id and s.captured_at <= now() - interval '7 days' and s.hf_upvotes is not null
    order by s.captured_at desc limit 1
  ) prev on true`);

const sentBefore = (isoWeek: string) => sql`exists (
  select 1 from research_signal.brief_items bi
  join research_signal.briefs b on b.id = bi.brief_id
  where bi.paper_id = p.id and b.iso_week <> ${isoWeek} and b.status in ('SCHEDULED', 'SENT'))`;

export async function loadTierThresholds(): Promise<TierThresholds> {
  const [row] = await db.select({ thresholds: appSettings.thresholds }).from(appSettings).where(eq(appSettings.id, 1));
  const t = row?.thresholds ?? {};
  const pick = (key: keyof TierThresholds) => (typeof t[key] === "number" ? t[key] : DEFAULT_TIER_THRESHOLDS[key]);
  return { hero: pick("hero"), standard: pick("standard"), compact: pick("compact") };
}

async function windowRows(window: BriefWindow): Promise<Row[]> {
  return db.execute<Row>(sql`
    select ${evidenceColumns}, ${sentBefore(window.isoWeek)} as sent_before
    from research_signal.paper_domain pd
    join research_signal.papers p on p.id = pd.paper_id
    join research_signal.domains d on d.id = pd.domain_id and d.active
    left join research_signal.evidence e on e.paper_id = p.id
    ${previousSnapshot}
    where pd.final_score is not null and pd.signal_type is not null
      and p.status in ('SCORED', 'FINALIST', 'SENT')
      and coalesce(p.announced_at, p.submitted_at, p.created_at) >= ${window.start.toISOString()}
      and coalesce(p.announced_at, p.submitted_at, p.created_at) < ${window.end.toISOString()}`);
}

// Papers from earlier briefs whose HF upvotes rose by >= 30% and >= 10 in a week.
async function risingRows(window: BriefWindow): Promise<Row[]> {
  return db.execute<Row>(sql`
    select distinct on (p.id) ${evidenceColumns}, true as sent_before
    from research_signal.papers p
    join research_signal.paper_domain pd on pd.paper_id = p.id and pd.final_score is not null
    join research_signal.domains d on d.id = pd.domain_id and d.active
    join research_signal.evidence e on e.paper_id = p.id and e.rising
    ${previousSnapshot}
    where ${sentBefore(window.isoWeek)}
      and coalesce(p.announced_at, p.submitted_at, p.created_at) >= ${window.end.toISOString()}::timestamptz - make_interval(weeks => ${RISING_LOOKBACK_WEEKS})
    order by p.id, pd.final_score desc`);
}

const SOURCE_NOTES: Record<string, string> = {
  arxiv: "arXiv: some announcements may be missing.",
  hf: "Hugging Face: upvotes, code and model links may be missing.",
  openreview: "OpenReview: venue status may be missing.",
  s2: "Semantic Scholar: citation counts and venues may be stale.",
  acl: "ACL Anthology: new proceedings may be missing.",
  cvf: "CVF open access: new proceedings may be missing.",
  pmlr: "PMLR: new proceedings may be missing.",
  unpaywall: "Unpaywall: full text was not used for some papers.",
  core: "CORE: full text was not used for some papers.",
};

async function sourceHealth(window: BriefWindow): Promise<SourceHealth[]> {
  const rows = await db.execute<{ kind: string; failed: boolean; errors: string | null }>(sql`
    select source_kind as kind, bool_or(status = 'FAILED') as failed, string_agg(distinct error, '; ') as errors
    from research_signal.source_runs
    where source_kind is not null and source_kind <> 'brief' and status in ('FAILED', 'PARTIAL')
      and started_at >= ${window.start.toISOString()}
    group by 1 order by 1`);
  const health: SourceHealth[] = rows.map((r) => ({
    kind: r.kind,
    status: r.failed ? "FAILED" : "PARTIAL",
    note: `${r.failed ? "Unavailable at times" : "Partly unavailable"}. ${SOURCE_NOTES[r.kind] ?? ""}`.trim(),
  }));
  const [credits] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from research_signal.llm_calls
    where status = 'credits_exhausted' and created_at >= ${window.start.toISOString()}`);
  if (credits && Number(credits.n) > 0) {
    health.push({ kind: "openrouter", status: "FAILED", note: "LLM credits ran out; some papers were not scored." });
  }
  return health;
}

function githubUrl(repo: string | null): string | null {
  const value = repo?.trim();
  if (!value) return null;
  return /^https?:\/\//.test(value) ? value : `https://github.com/${value.replace(/^github\.com\//, "")}`;
}

function evidenceOf(r: Row): Evidence {
  const up = r.hf_upvotes === null ? null : Number(r.hf_upvotes);
  const prev = r.prev_upvotes === null ? null : Number(r.prev_upvotes);
  return {
    hf_upvotes: up,
    hf_comments: r.hf_comments === null ? null : Number(r.hf_comments),
    github_stars: r.github_stars === null ? null : Number(r.github_stars),
    linked: r.linked === null ? null : Number(r.linked),
    s2_citations: r.s2_citations === null ? null : Number(r.s2_citations),
    rising_pct: up !== null && prev !== null && prev > 0 ? ((up - prev) / prev) * 100 : null,
    final_score: Number(r.final_score),
  };
}

function toCard(r: Row, cardId: string, tier: Tier): BriefCard {
  return {
    cardId,
    paperId: r.paper_id,
    arxivId: r.arxiv_id,
    domainId: Number(r.domain_id),
    tier,
    inTop3: false,
    title: r.title,
    abstract: r.abstract,
    status: r.status,
    final: Number(r.final_score),
    verdict: r.verdict ?? "SKIP",
    rung: r.rung ?? "LAB",
    signalType: r.signal_type ?? "METHOD",
    novelty: Number(r.novelty ?? 0),
    llmRelevance: Number(r.llm_relevance ?? 0),
    cosine: Number(r.cosine ?? 0),
    clientAngle: r.client_angle ?? "",
    links: {
      abs: r.url_abs,
      pdf: r.url_pdf,
      code: githubUrl(r.github_repo),
      hf: r.arxiv_id && r.hf_upvotes !== null ? `https://huggingface.co/papers/${r.arxiv_id}` : null,
    },
    evidence: evidenceOf(r),
  };
}

const byFinal = (a: Row, b: Row) => Number(b.final_score) - Number(a.final_score);

function withOverride(r: Row, overrides: RerankOverrides | undefined): Row {
  const o = overrides?.get(overrideKey(r.paper_id, Number(r.domain_id)));
  return o
    ? { ...r, final_score: o.final, verdict: o.verdict, signal_type: o.signalType, novelty: o.novelty, client_angle: o.clientAngle }
    : r;
}

// Picks the brief's papers for one window (design D13). Each paper appears once, in the domain
// where it scores highest; earlier briefs' papers only return through the rising lane. `overrides`
// overlays re-judged scores that were not written to paper_domain (dry and preview runs).
export async function selectBrief(window: BriefWindow, overrides?: RerankOverrides): Promise<BriefSelection> {
  const [thresholds, stored, rising, health, active] = await Promise.all([
    loadTierThresholds(),
    windowRows(window),
    risingRows(window),
    sourceHealth(window),
    db.execute<{ id: number; name: string }>(sql`
      select id, name from research_signal.domains where active order by id`),
  ]);

  const rows = stored.map((r) => withOverride(r, overrides));
  const fresh = rows.filter((r) => !r.sent_before);
  const best = new Map<string, Row>();
  for (const r of [...fresh].sort(byFinal)) if (!best.has(r.paper_id)) best.set(r.paper_id, r);

  const cards: Record<string, BriefCard> = {};
  const cardOf = new Map<string, string>();
  const add = (r: Row, tier: Tier) => {
    const cardId = `p${Object.keys(cards).length + 1}`;
    cards[cardId] = toCard(r, cardId, tier);
    cardOf.set(r.paper_id, cardId);
    return cardId;
  };

  const ranked = [...best.values()].sort(byFinal);
  const top3Papers = new Set(
    ranked.filter((r) => Number(r.final_score) >= thresholds.compact).slice(0, TOP3_SIZE).map((r) => r.paper_id),
  );

  const domains: DomainSelection[] = active.map((d) => {
    const domainId = Number(d.id);
    const own = ranked.filter((r) => Number(r.domain_id) === domainId);
    const section: DomainSelection = {
      domainId,
      name: d.name,
      slug: domainSlug(domainId),
      hero: null,
      standard: [],
      compact: [],
      quiet: false,
      nearestMiss: null,
    };
    let rest = own;
    if (rest[0] && Number(rest[0].final_score) >= thresholds.hero) {
      section.hero = add(rest[0], "HERO");
      rest = rest.slice(1);
    }
    const standard = rest.filter((r) => Number(r.final_score) >= thresholds.standard).slice(0, TIER_CAPS.standard);
    section.standard = standard.map((r) => add(r, "STANDARD"));
    rest = rest.filter((r) => !standard.includes(r));
    section.compact = rest
      .filter((r) => Number(r.final_score) >= thresholds.compact)
      .slice(0, TIER_CAPS.compact)
      .map((r) => add(r, "COMPACT"));

    return section;
  });

  // Quiet means no paper was placed in the domain (a qualifying paper may sit in a domain where it
  // scores higher). The nearest miss prefers a paper shown nowhere else in the brief.
  for (const section of domains) {
    if (section.hero || section.standard.length || section.compact.length) continue;
    section.quiet = true;
    const domainRows = fresh.filter((r) => Number(r.domain_id) === section.domainId).sort(byFinal);
    const miss = domainRows.find((r) => !cardOf.has(r.paper_id)) ?? domainRows[0];
    section.nearestMiss = miss ? { paperId: miss.paper_id, title: miss.title, final: Number(miss.final_score) } : null;
  }

  const top3 = [...top3Papers].map((paperId) => cardOf.get(paperId)).filter((id): id is string => Boolean(id));
  for (const id of top3) cards[id].inTop3 = true;

  const risingIds = rising
    .filter((r) => !cardOf.has(r.paper_id))
    .map((r) => ({ r, pct: evidenceOf(r).rising_pct ?? 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, RISING_CAP)
    .map(({ r }) => add(r, "RISING"));

  return {
    isoWeek: window.isoWeek,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    label: window.label,
    cards,
    top3,
    domains,
    rising: risingIds,
    sourceHealth: health,
  };
}

export function selectionCounts(selection: BriefSelection) {
  return selection.domains.map((d) => ({
    domain: d.name,
    hero: d.hero ? 1 : 0,
    standard: d.standard.length,
    compact: d.compact.length,
    quiet: d.quiet,
  }));
}

export const isEmptySelection = (selection: BriefSelection) => Object.keys(selection.cards).length === 0;
