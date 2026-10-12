import { tool } from "ai";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { domains, paperDomain, papers, sources } from "@/db/schema";
import { embedTexts } from "@/lib/llm/embed";
import { enqueue } from "@/lib/pipeline/jobs";
import type { Rung } from "@/lib/pipeline/rank";
import { searchFiltersSchema } from "@/lib/search/query";
import { getFullText } from "@/lib/sources/fulltext";
import { getSourceSecret } from "@/lib/sources/registry";
import { writeHfSignals } from "@/lib/sources/hf";
import { normalizeTitle } from "@/lib/sources/openreview";
import { httpGet } from "@/lib/sources/types";
import type { AskCitation } from "./answer";
import type { RoutedIntent } from "./route-intent";

export const ASK_TOOL_NAMES = [
  "search_index",
  "get_papers",
  "trend",
  "related",
  "my_log",
  "get_fulltext",
  "live_search",
] as const;
export type AskToolName = (typeof ASK_TOOL_NAMES)[number];

export const SEARCH_TOP = 20;
// gemini-embedding cosines sit high for any text: off-topic queries ("medieval cheese fermentation",
// "sourdough baking") top out at 0.46-0.50, on-topic AI queries put their 5th-best hit at 0.57-0.62.
export const RELEVANT_COSINE = 0.55;
export const LIVE_MIN_HITS = 5;
export const MAX_FULLTEXT = 2;
export const RELATED_K = 8;
const LIVE_LIMIT = 10;
const ABSTRACT_CHARS = 700;
// Cards for the top hits of the first search go into the first message, so the model can write
// without a get_papers round.
export const PRELOAD_PAPERS = SEARCH_TOP;
const HF_SEARCH = "https://huggingface.co/api/papers/search";

export const EVIDENCE_FIELDS = ["upvotes", "comments", "stars", "models", "spaces", "citations"] as const;
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];
export type Evidence = Partial<Record<EvidenceField, number | null>>;

export type PaperRef = {
  ref: string;
  paperId: string;
  title: string;
  rung: Rung | null;
  relevant: boolean;
  evidence: Evidence;
  // Serialised tool output about this paper: numbers attributed to a cited paper must appear here.
  data: string[];
  // Citation fields for the client-safe source list, set by the tools that read them.
  arxivId?: string | null;
  urlAbs?: string | null;
  authors?: string[];
};

const CITED_AUTHORS = 3;

// The citation saved with an answer for one of its refs.
export function citationOf(entry: PaperRef): AskCitation {
  return {
    ref: entry.ref,
    paperId: entry.paperId,
    title: entry.title,
    rung: entry.rung,
    ...(entry.arxivId !== undefined ? { arxivId: entry.arxivId } : {}),
    ...(entry.urlAbs !== undefined ? { urlAbs: entry.urlAbs } : {}),
    ...(entry.authors?.length ? { authors: entry.authors } : {}),
  };
}

export type AskContext = {
  routed: RoutedIntent;
  // Tags this request's llm_calls rows (stage suffix "#<uuid>", split by scripts/sql/009).
  requestId: string | null;
  firstIndexedAt: Date | null;
  refs: Map<string, PaperRef>;
  byPaper: Map<string, PaperRef>;
  strongHits: number | null;
  fulltextCalls: number;
  live: { used: boolean; found: number; inserted: number };
  // Serialised tool outputs, given to the repair call.
  retrieved: string[];
  // Tool output not tied to one paper (trend weeks and totals); numbers may come from here too.
  aggregates: string[];
};

export function createAskContext(routed: RoutedIntent, firstIndexedAt: Date | null, requestId: string | null = null): AskContext {
  return {
    routed,
    requestId,
    firstIndexedAt,
    refs: new Map(),
    byPaper: new Map(),
    strongHits: null,
    fulltextCalls: 0,
    live: { used: false, found: 0, inserted: 0 },
    retrieved: [],
    aggregates: [],
  };
}

export function stageFor(ctx: Pick<AskContext, "requestId">, stage: string): string {
  return ctx.requestId ? `${stage}#${ctx.requestId}` : stage;
}

type RefInput = {
  paperId: string;
  title: string;
  rung?: Rung | null;
  relevant?: boolean;
  evidence?: Evidence;
  arxivId?: string | null;
  urlAbs?: string | null;
  authors?: string[];
};

function citationFields(input: RefInput): Pick<PaperRef, "arxivId" | "urlAbs" | "authors"> {
  return {
    ...(input.arxivId !== undefined ? { arxivId: input.arxivId } : {}),
    ...(input.urlAbs !== undefined ? { urlAbs: input.urlAbs } : {}),
    ...(input.authors?.length ? { authors: input.authors.slice(0, CITED_AUTHORS) } : {}),
  };
}

function register(ctx: AskContext, input: RefInput): PaperRef {
  const existing = ctx.byPaper.get(input.paperId);
  if (existing) {
    if (input.rung !== undefined) existing.rung = input.rung;
    if (input.relevant) existing.relevant = true;
    if (input.evidence) existing.evidence = { ...existing.evidence, ...input.evidence };
    Object.assign(existing, citationFields(input));
    return existing;
  }
  const entry: PaperRef = {
    ref: `p${ctx.refs.size + 1}`,
    paperId: input.paperId,
    title: input.title,
    rung: input.rung ?? null,
    relevant: input.relevant ?? false,
    evidence: input.evidence ?? {},
    data: [],
    ...citationFields(input),
  };
  ctx.refs.set(entry.ref, entry);
  ctx.byPaper.set(entry.paperId, entry);
  return entry;
}

// Keeps what a tool said about one paper and returns it unchanged.
function about<T>(entry: PaperRef, output: T): T {
  entry.data.push(JSON.stringify(output));
  return output;
}

function record<T>(ctx: AskContext, output: T): T {
  ctx.retrieved.push(JSON.stringify(output));
  return output;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Accepts a ref (p3) or a paper uuid.
function resolve(ctx: AskContext, id: string): string | null {
  const trimmed = id.trim().replace(/^\[|\]$/g, "");
  const byRef = ctx.refs.get(trimmed.toLowerCase());
  if (byRef) return byRef.paperId;
  return UUID.test(trimmed) ? trimmed.toLowerCase() : null;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const day = (v: string | Date | null) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const round2 = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

type EvidenceRow = {
  rung: Rung | null;
  hf_upvotes: number | null;
  hf_comments: number | null;
  github_stars: number | null;
  linked_models: number | null;
  linked_spaces: number | null;
  s2_citations: number | null;
};

function evidenceOf(row: EvidenceRow): Evidence {
  return {
    upvotes: num(row.hf_upvotes),
    comments: num(row.hf_comments),
    stars: num(row.github_stars),
    models: num(row.linked_models),
    spaces: num(row.linked_spaces),
    citations: num(row.s2_citations),
  };
}

async function searchIndex(ctx: AskContext, q: string, filters: z.infer<typeof searchFiltersSchema>) {
  const [vector] = await embedTexts([q], stageFor(ctx, "search_query"));
  const vec = `[${vector.join(",")}]`;
  const rows = await db.execute<{
    paper_id: string;
    title: string;
    published_at: string | null;
    attention: number | null;
    cosine: number | null;
    rung: Rung | null;
  }>(sql`
    select h.paper_id, h.title, h.published_at, h.attention,
      -- hybrid_search returns this similarity itself once scripts/sql/007 is applied; the join covers older versions.
      coalesce((to_jsonb(h) ->> 'similarity')::float8, -(d.embedding <#> ${vec}::extensions.halfvec(768))) as cosine, e.rung
    from research_signal.hybrid_search(${q}::text, ${vec}::extensions.halfvec(768), ${JSON.stringify(filters)}::jsonb, ${SEARCH_TOP}::int) h
    join research_signal.search_docs d on d.id = h.id
    left join research_signal.evidence e on e.paper_id = h.paper_id
    where h.paper_id is not null
    order by h.score desc`);

  const best = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const prev = best.get(row.paper_id);
    if (!prev || Number(row.cosine ?? -1) > Number(prev.cosine ?? -1)) best.set(row.paper_id, row);
  }
  const hits = [...best.values()].map((row) => {
    const cosine = round2(row.cosine);
    const entry = register(ctx, {
      paperId: row.paper_id,
      title: row.title,
      rung: row.rung,
      relevant: cosine !== null && cosine >= RELEVANT_COSINE,
    });
    return about(entry, {
      ref: entry.ref,
      title: row.title,
      published: day(row.published_at),
      cosine,
      rung: row.rung,
      attention: round2(row.attention),
    });
  });
  const strong = hits.filter((h) => h.cosine !== null && h.cosine >= RELEVANT_COSINE).length;
  ctx.strongHits = Math.max(ctx.strongHits ?? 0, strong);
  return {
    hits,
    strongHits: strong,
    liveSearchAllowed: liveGate(ctx).allowed,
  };
}

// markRelevant: papers the model asked for count as relevant; preloaded cards keep their search flag.
async function getPapers(ctx: AskContext, ids: string[], markRelevant = true) {
  const resolved = [...new Set(ids.map((id) => resolve(ctx, id)).filter((id): id is string => id !== null))];
  if (resolved.length === 0) return { papers: [], error: "No known paper refs or ids given" };
  const rows = await db.execute<
    EvidenceRow & {
      id: string;
      arxiv_id: string | null;
      title: string;
      abstract: string;
      authors: string[];
      source: string;
      url_abs: string | null;
      published: string | null;
      github_repo: string | null;
      venue: string | null;
      or_venue: string | null;
      or_decision: string | null;
      rising: boolean | null;
      domains: { domain: string; verdict: string | null; final: number | null; signalType: string | null; clientAngle: string | null; riskFlags: string[] }[] | null;
    }
  >(sql`
    select p.id, p.arxiv_id, p.title, p.abstract, p.authors, p.source, p.url_abs,
      coalesce(p.announced_at, p.submitted_at) as published,
      e.rung, e.hf_upvotes, e.hf_comments, e.github_repo, e.github_stars, e.linked_models,
      e.linked_spaces, e.s2_citations, e.venue, e.or_venue, e.or_decision, e.rising,
      (select json_agg(json_build_object(
          'domain', d.name, 'verdict', pd.verdict, 'final', round(pd.final_score::numeric, 2),
          'signalType', pd.signal_type, 'clientAngle', pd.client_angle, 'riskFlags', pd.risk_flags)
        order by pd.final_score desc nulls last)
       from research_signal.paper_domain pd
       join research_signal.domains d on d.id = pd.domain_id
       where pd.paper_id = p.id) as domains
    from research_signal.papers p
    left join research_signal.evidence e on e.paper_id = p.id
    where p.id in ${resolved}`);

  return {
    papers: rows.map((row) => {
      const entry = register(ctx, {
        paperId: row.id,
        title: row.title,
        rung: row.rung,
        relevant: markRelevant,
        evidence: evidenceOf(row),
        arxivId: row.arxiv_id,
        urlAbs: row.url_abs,
        authors: row.authors,
      });
      return about(entry, {
        ref: entry.ref,
        title: row.title,
        authors: row.authors.slice(0, 4),
        published: day(row.published),
        source: row.source,
        url: row.url_abs,
        rung: row.rung,
        rising: row.rising ?? false,
        evidence: entry.evidence,
        githubRepo: row.github_repo,
        venue: row.venue ?? row.or_venue,
        reviewDecision: row.or_decision,
        domains: row.domains ?? [],
        abstract: row.abstract.slice(0, ABSTRACT_CHARS),
      });
    }),
  };
}

async function trend(ctx: AskContext, input: { q?: string | null; domainId?: number | null; since?: string | null; bucket: "week" }) {
  const since = input.since ?? ctx.routed.since ?? new Date(Date.now() - 8 * 7 * 86_400_000).toISOString().slice(0, 10);
  const q = input.q?.trim() || null;
  const domainId = input.domainId ?? null;
  const rows = await db.execute<{
    week: string;
    papers: number;
    lab: number;
    code: number;
    model: number;
    peer: number;
    attention: number;
    top: { id: string; title: string; upvotes: number; rising: boolean; rung: Rung | null }[] | null;
  }>(sql`
    with base as (
      select p.id, p.title, e.rung, coalesce(e.hf_upvotes, 0) as upvotes, coalesce(e.rising, false) as rising,
        date_trunc('week', coalesce(p.announced_at, p.submitted_at)) as week
      from research_signal.papers p
      left join research_signal.evidence e on e.paper_id = p.id
      where p.status not in ('NEW', 'DROPPED')
        and coalesce(p.announced_at, p.submitted_at) >= ${since}::timestamptz
        and (${q}::text is null or p.fts @@ websearch_to_tsquery('english', ${q}::text))
        and (${domainId}::int is null or exists (
          select 1 from research_signal.paper_domain pd where pd.paper_id = p.id and pd.domain_id = ${domainId}::int))
    )
    select b.week, count(*)::int as papers,
      count(*) filter (where b.rung = 'LAB' or b.rung is null)::int as lab,
      count(*) filter (where b.rung = 'CODE')::int as code,
      count(*) filter (where b.rung = 'MODEL')::int as model,
      count(*) filter (where b.rung = 'PEER')::int as peer,
      sum(b.upvotes)::int as attention,
      (select json_agg(t) from (
        select b2.id, b2.title, b2.upvotes, b2.rising, b2.rung from base b2
        where b2.week = b.week order by b2.rising desc, b2.upvotes desc limit 3) t) as top
    from base b
    group by b.week
    order by b.week`);

  const weeks = rows.map((row) => ({
    week: day(row.week),
    papers: Number(row.papers),
    rungs: { LAB: Number(row.lab), CODE: Number(row.code), MODEL: Number(row.model), PEER: Number(row.peer) },
    attention: Number(row.attention),
    top: (row.top ?? []).map((t) => {
      const entry = register(ctx, { paperId: t.id, title: t.title, rung: t.rung, relevant: q !== null || domainId !== null });
      return about(entry, { ref: entry.ref, title: t.title, upvotes: t.upvotes, rising: t.rising });
    }),
  }));
  const counts = weeks.map((w) => w.papers);
  const recent = counts.slice(-2).reduce((a, b) => a + b, 0);
  const earlier = counts.slice(-4, -2).reduce((a, b) => a + b, 0);
  const momentum =
    counts.length < 3 ? "unknown" : recent > earlier * 1.2 ? "rising" : recent < earlier * 0.8 ? "fading" : "steady";
  const output = { since, bucket: "week", total: counts.reduce((a, b) => a + b, 0), momentum, weeks };
  ctx.aggregates.push(JSON.stringify({ ...output, weeks: weeks.map((w) => ({ week: w.week, papers: w.papers, rungs: w.rungs, attention: w.attention })) }));
  return output;
}

async function related(ctx: AskContext, paperId: string) {
  const id = resolve(ctx, paperId);
  if (!id) return { neighbours: [], buildsOn: null, error: "Unknown paper ref or id" };
  const neighbours = await db.execute<{ id: string; title: string; cosine: number; rung: Rung | null }>(sql`
    with n as (
      select p2.id, p2.title, -(p2.embedding <#> p.embedding) as cosine
      from research_signal.papers p
      join research_signal.papers p2 on p2.id <> p.id and p2.embedding is not null
      where p.id = ${id}::uuid and p.embedding is not null
      order by p2.embedding <#> p.embedding
      limit ${RELATED_K}
    )
    select n.id, n.title, n.cosine, e.rung
    from n left join research_signal.evidence e on e.paper_id = n.id
    order by n.cosine desc`);
  const [latest] = await db.execute<{ builds_on: { title: string; citationCount: number | null }[] | null }>(sql`
    select builds_on from research_signal.latest_signals where paper_id = ${id}::uuid`);
  const output = {
    neighbours: neighbours.map((row) => {
      const cosine = round2(row.cosine);
      const entry = register(ctx, { paperId: row.id, title: row.title, rung: row.rung, relevant: (cosine ?? 0) >= RELEVANT_COSINE });
      return about(entry, { ref: entry.ref, title: row.title, cosine, rung: row.rung });
    }),
    buildsOn: latest?.builds_on ? latest.builds_on.map((b) => ({ title: b.title, citations: b.citationCount })) : null,
  };
  const source = ctx.byPaper.get(id);
  if (source && output.buildsOn) about(source, { buildsOn: output.buildsOn });
  return output;
}

async function myLog(
  ctx: AskContext,
  input: { action?: "READ" | "CLIENT" | "SKIP" | null; clientTag?: string | null; since?: string | null; q?: string | null },
) {
  const tag = input.clientTag?.trim() ? `%${input.clientTag.trim()}%` : null;
  const q = input.q?.trim() ? `%${input.q.trim()}%` : null;
  const rows = await db.execute<{
    paper_id: string;
    title: string;
    action: string;
    note: string | null;
    client_tag: string | null;
    created_at: string;
    rung: Rung | null;
  }>(sql`
    select a.paper_id, p.title, a.action, a.note, a.client_tag, a.created_at, e.rung
    from research_signal.actions a
    join research_signal.papers p on p.id = a.paper_id
    left join research_signal.evidence e on e.paper_id = a.paper_id
    where (${input.action ?? null}::text is null or a.action::text = ${input.action ?? null}::text)
      and (${tag}::text is null or a.client_tag ilike ${tag}::text)
      and (${input.since ?? null}::text is null or a.created_at >= ${input.since ?? null}::timestamptz)
      and (${q}::text is null or p.title ilike ${q}::text or a.note ilike ${q}::text)
    order by a.created_at desc
    limit 30`);
  return {
    entries: rows.map((row) => {
      const entry = register(ctx, { paperId: row.paper_id, title: row.title, rung: row.rung, relevant: true });
      return about(entry, {
        ref: entry.ref,
        title: row.title,
        action: row.action,
        note: row.note,
        clientTag: row.client_tag,
        at: day(row.created_at),
      });
    }),
  };
}

// The CORE fallback is used only while the core source is enabled and has a key.
async function coreApiKey(): Promise<string | undefined> {
  const [core] = await db.select({ enabled: sources.enabled }).from(sources).where(eq(sources.kind, "core"));
  if (!core?.enabled) return undefined;
  return getSourceSecret("core").catch(() => undefined);
}

async function fulltext(ctx: AskContext, paperId: string) {
  if (ctx.fulltextCalls >= MAX_FULLTEXT) return { error: `Full text is limited to ${MAX_FULLTEXT} papers per question` };
  const id = resolve(ctx, paperId);
  if (!id) return { error: "Unknown paper ref or id" };
  ctx.fulltextCalls++;
  const [paper] = await db
    .select({ id: papers.id, title: papers.title, arxivId: papers.arxivId, doi: papers.doi })
    .from(papers)
    .where(eq(papers.id, id));
  if (!paper) return { error: "Unknown paper" };
  const entry = register(ctx, { paperId: paper.id, title: paper.title, relevant: true });
  const result = await getFullText(paper, { coreApiKey: await coreApiKey() });
  if (!result) return { ref: entry.ref, error: "No full text available" };
  about(entry, result.text);
  return { ref: entry.ref, source: result.source, text: `<untrusted_paper_text>\n${result.text}\n</untrusted_paper_text>` };
}

export function liveGate(ctx: AskContext): { allowed: boolean; reason: string } {
  const since = ctx.routed.since ? new Date(ctx.routed.since) : null;
  if (since && ctx.firstIndexedAt && since < ctx.firstIndexedAt) {
    return { allowed: true, reason: "the question starts before the index" };
  }
  if (ctx.strongHits === null) return { allowed: false, reason: "call search_index first" };
  if (ctx.strongHits < LIVE_MIN_HITS) {
    return { allowed: true, reason: `search_index found ${ctx.strongHits} hits with cosine >= ${RELEVANT_COSINE}` };
  }
  return { allowed: false, reason: `search_index already found ${ctx.strongHits} relevant hits` };
}

type HfSearchItem = {
  paper?: {
    id?: string;
    title?: string;
    summary?: string;
    publishedAt?: string;
    authors?: { name?: string }[];
    upvotes?: number;
    githubRepo?: string;
    githubStars?: number;
  };
};

async function liveSearch(ctx: AskContext, q: string) {
  const gate = liveGate(ctx);
  if (!gate.allowed) return { skipped: gate.reason, papers: [] };
  if (ctx.live.used) return { skipped: "live_search already ran for this question", papers: [] };
  ctx.live.used = true;

  const response = await httpGet(`${HF_SEARCH}?q=${encodeURIComponent(q)}`, {}, 15_000);
  if (!response.ok) return { error: `Hugging Face search failed: HTTP ${response.status}`, papers: [] };
  const items = ((await response.json()) as HfSearchItem[])
    .map((item) => item.paper)
    .filter((p): p is NonNullable<HfSearchItem["paper"]> => Boolean(p?.id && p.title))
    .slice(0, LIVE_LIMIT);
  ctx.live.found = items.length;
  if (items.length === 0) return { papers: [] };

  const inserted = await db
    .insert(papers)
    .values(
      items.map((p) => ({
        arxivId: p.id!,
        source: "live",
        title: p.title!.replace(/\s+/g, " ").trim(),
        abstract: (p.summary ?? "").replace(/\s+/g, " ").trim(),
        authors: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
        submittedAt: p.publishedAt ? new Date(p.publishedAt) : null,
        urlAbs: `https://arxiv.org/abs/${p.id}`,
        urlPdf: `https://arxiv.org/pdf/${p.id}`,
        urlHtml: `https://arxiv.org/html/${p.id}`,
        status: "PREFILTERED" as const,
        titleNorm: normalizeTitle(p.title!),
      })),
    )
    .onConflictDoNothing({ target: papers.arxivId })
    .returning({ id: papers.id, arxivId: papers.arxivId });
  ctx.live.inserted = inserted.length;

  if (inserted.length > 0) {
    const domainIds = ctx.routed.domains.length
      ? ctx.routed.domains
      : (await db.select({ id: domains.id }).from(domains).where(eq(domains.active, true)).orderBy(asc(domains.id))).map((d) => d.id);
    await db
      .insert(paperDomain)
      .values(inserted.flatMap((p) => domainIds.map((domainId) => ({ paperId: p.id, domainId }))))
      .onConflictDoNothing();
    const fresh = new Set(inserted.map((p) => p.arxivId));
    await writeHfSignals(
      items
        .filter((p) => fresh.has(p.id!))
        .map((p) => ({
          arxivId: p.id!,
          title: p.title!,
          upvotes: typeof p.upvotes === "number" ? p.upvotes : null,
          githubRepo: p.githubRepo?.trim() || null,
          githubStars: typeof p.githubStars === "number" ? p.githubStars : null,
          linkedModels: null,
          linkedSpaces: null,
        })),
    );
    await enqueue("embed2");
  }

  const arxivIds = items.map((p) => p.id!);
  const rows = await db.execute<EvidenceRow & { id: string; arxiv_id: string; title: string; abstract: string; published: string | null }>(sql`
    select p.id, p.arxiv_id, p.title, p.abstract, coalesce(p.announced_at, p.submitted_at) as published,
      e.rung, e.hf_upvotes, e.hf_comments, e.github_stars, e.linked_models, e.linked_spaces, e.s2_citations
    from research_signal.papers p
    left join research_signal.evidence e on e.paper_id = p.id
    where p.arxiv_id in ${arxivIds}`);
  const byArxiv = new Map(rows.map((r) => [r.arxiv_id, r]));
  return {
    reason: gate.reason,
    papers: arxivIds.flatMap((arxivId) => {
      const row = byArxiv.get(arxivId);
      if (!row) return [];
      const item = items.find((p) => p.id === arxivId);
      const entry = register(ctx, {
        paperId: row.id,
        title: row.title,
        rung: row.rung,
        relevant: true,
        evidence: evidenceOf(row),
        arxivId: row.arxiv_id,
        urlAbs: `https://arxiv.org/abs/${row.arxiv_id}`,
        authors: (item?.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
      });
      return [
        about(entry, {
          ref: entry.ref,
          title: row.title,
          published: day(row.published),
          rung: row.rung,
          evidence: entry.evidence,
          abstract: row.abstract.slice(0, ABSTRACT_CHARS),
        }),
      ];
    }),
  };
}

const refOrId = z.string().min(1).describe("A paper ref such as p3, or a paper uuid");

// The playbook's first search plus the cards of its top hits, run in code before the model starts
// so the model can write without spending tool rounds on them.
export async function initialSearch(ctx: AskContext, q: string) {
  const filters = ctx.routed.since ? { since: ctx.routed.since } : {};
  const output = record(ctx, await searchIndex(ctx, q, filters));
  const top = output.hits.slice(0, PRELOAD_PAPERS).map((h) => h.ref);
  const cards = top.length ? record(ctx, await getPapers(ctx, top, false)).papers : [];
  return { input: { q, filters }, output, papers: cards };
}

export function askTools(ctx: AskContext) {
  return {
    search_index: tool({
      description: `Hybrid keyword + semantic search over the indexed papers, top ${SEARCH_TOP}. Returns refs, cosine similarity and rung. Call this first.`,
      inputSchema: z.object({
        q: z.string().min(1).max(300).describe("Search phrase"),
        filters: searchFiltersSchema.default({}).describe("Optional: domainId, since, until (ISO dates), source, minRung, action, hasCode"),
      }),
      execute: async ({ q, filters }) => record(ctx, await searchIndex(ctx, q, filters)),
    }),
    get_papers: tool({
      description: "Card fields for papers: abstract, authors, per-domain verdict, score and client angle, latest signals (evidence) and rung.",
      inputSchema: z.object({ ids: z.array(refOrId).min(1).max(10) }),
      execute: async ({ ids }) => record(ctx, await getPapers(ctx, ids)),
    }),
    trend: tool({
      description: "Weekly counts, rung mix, summed Hugging Face upvotes and top rising papers for a topic or domain since a date, plus momentum.",
      inputSchema: z.object({
        q: z.string().max(200).nullish().describe("Keyword query; omit to use only the domain"),
        domainId: z.number().int().positive().nullish(),
        since: z.iso.date().nullish().describe("Start date, YYYY-MM-DD; defaults to 8 weeks ago"),
        bucket: z.literal("week").default("week"),
      }),
      execute: async (input) => record(ctx, await trend(ctx, input)),
    }),
    related: tool({
      description: `The ${RELATED_K} nearest papers by embedding, plus the references the paper builds on when known.`,
      inputSchema: z.object({ paperId: refOrId }),
      execute: async ({ paperId }) => record(ctx, await related(ctx, paperId)),
    }),
    my_log: tool({
      description: "The consultant's own logged actions (READ, CLIENT, SKIP), notes and client tags.",
      inputSchema: z.object({
        action: z.enum(["READ", "CLIENT", "SKIP"]).nullish(),
        clientTag: z.string().max(100).nullish(),
        since: z.iso.date().nullish(),
        q: z.string().max(200).nullish().describe("Match against paper title or note"),
      }),
      execute: async (input) => record(ctx, await myLog(ctx, input)),
    }),
    get_fulltext: tool({
      description: `Full text of one paper (arXiv HTML or open access), up to 20,000 characters. At most ${MAX_FULLTEXT} per question.`,
      inputSchema: z.object({ paperId: refOrId }),
      execute: async ({ paperId }) => record(ctx, await fulltext(ctx, paperId)),
    }),
    live_search: tool({
      description: `Live Hugging Face Papers search. Only allowed when search_index found fewer than ${LIVE_MIN_HITS} hits with cosine >= ${RELEVANT_COSINE}, or the question starts before the index. Results are added to the index.`,
      inputSchema: z.object({ q: z.string().min(1).max(200) }),
      execute: async ({ q }) => record(ctx, await liveSearch(ctx, q)),
    }),
  } satisfies Record<AskToolName, unknown>;
}

export type AskTools = ReturnType<typeof askTools>;
