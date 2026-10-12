import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import pLimit from "p-limit";
import { db } from "@/db/client";
import { appSettings, domains, papers } from "@/db/schema";
import { embedTexts } from "@/lib/llm/embed";
import { upsertSearchDocs } from "@/lib/search/index";
import { recomputeCentroids } from "./centroids";
import { enqueue } from "./jobs";

const EMBED1_LIMIT = 1500;
const EMBED2_LIMIT = 500;
const PASS1_MAX_CHARS = 300;
const PASS2_MAX_CHARS = 2000;
const TOP_PER_DOMAIN_DAY = 40;
const DEFAULT_FLOOR = 0.2;
const WRITE_CHUNK = 100;
const EMBED_CHUNK = 100;
const EMBED_CONCURRENCY = 4;

// The announcement day a paper counts against for the per-domain cap. Backstop items have no
// announced_at, so they fall back to the submission date.
export function announceDay(alias = "p") {
  return sql.raw(
    `(coalesce(${alias}.announced_at, ${alias}.submitted_at, ${alias}.created_at) at time zone 'UTC')::date::text`,
  );
}

export type Embed1Result = {
  processed: number;
  prefiltered: number;
  dropped: number;
  kept: { domainId: number; day: string; count: number }[];
};

export type Embed2Result = { shortlisted: number; remaining: boolean };

// embedTexts sends its batches one after another; running chunks side by side cuts wall time.
async function embedParallel(texts: string[], stage: string): Promise<number[][]> {
  const limit = pLimit(EMBED_CONCURRENCY);
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_CHUNK) chunks.push(texts.slice(i, i + EMBED_CHUNK));
  const results = await Promise.all(chunks.map((chunk) => limit(() => embedTexts(chunk, stage))));
  return results.flat();
}

const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);

function firstSentence(abstract: string): string {
  const match = abstract.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (match ? match[0] : abstract).trim();
}

export function pass1Text(title: string, abstract: string): string {
  return `${title}. ${firstSentence(abstract)}`.slice(0, PASS1_MAX_CHARS);
}

export function pass2Text(title: string, abstract: string): string {
  return `${title}\n\n${abstract}`.slice(0, PASS2_MAX_CHARS);
}

async function prefilterFloor(): Promise<number> {
  const [row] = await db.select({ thresholds: appSettings.thresholds }).from(appSettings).where(eq(appSettings.id, 1));
  const floor = row?.thresholds?.prefilter_floor;
  return typeof floor === "number" ? floor : DEFAULT_FLOOR;
}

async function activeDomains() {
  const select = () =>
    db
      .select({ id: domains.id, excludes: domains.excludes, centroid: domains.centroid })
      .from(domains)
      .where(eq(domains.active, true))
      .orderBy(asc(domains.id));
  let rows = await select();
  const missing = rows.filter((d) => !d.centroid).map((d) => d.id);
  if (missing.length > 0) {
    await recomputeCentroids(missing);
    rows = await select();
  }
  return rows.filter((d): d is typeof d & { centroid: number[] } => d.centroid !== null);
}

function isExcluded(excludes: string[], title: string, abstract: string): boolean {
  if (excludes.length === 0) return false;
  const text = `${title}\n${abstract}`.toLowerCase();
  return excludes.some((term) => term.trim() && text.includes(term.trim().toLowerCase()));
}

// Rows already kept for each domain and day by earlier calls, so the cap holds across calls.
async function usedQuota(days: string[]): Promise<Map<string, number>> {
  if (days.length === 0) return new Map();
  const rows = await db.execute<{ domain_id: number; day: string; n: number }>(sql`
    select pd.domain_id, ${announceDay()} as day, count(*)::int as n
    from research_signal.paper_domain pd
    join research_signal.papers p on p.id = pd.paper_id
    where p.status <> 'DROPPED' and p.status <> 'NEW' and p.source <> 'live'
      and ${announceDay()} = any(${`{${days.join(",")}}`}::text[])
    group by 1, 2`);
  return new Map(rows.map((r) => [`${r.domain_id}|${r.day}`, Number(r.n)]));
}

export async function runEmbed1(paperIds?: string[]): Promise<Embed1Result> {
  const batch = await db
    .select({
      id: papers.id,
      title: papers.title,
      abstract: papers.abstract,
      day: sql<string>`${announceDay("papers")}`,
    })
    .from(papers)
    .where(and(eq(papers.status, "NEW"), paperIds ? inArray(papers.id, paperIds) : undefined))
    .orderBy(asc(papers.createdAt))
    .limit(EMBED1_LIMIT);
  if (batch.length === 0) return { processed: 0, prefiltered: 0, dropped: 0, kept: [] };

  const [floor, active] = await Promise.all([prefilterFloor(), activeDomains()]);
  const vectors = await embedParallel(
    batch.map((p) => pass1Text(p.title, p.abstract)),
    "embed1",
  );
  const used = await usedQuota([...new Set(batch.map((p) => p.day))]);

  const rows: { paper_id: string; domain_id: number; cosine: number }[] = [];
  const kept: Embed1Result["kept"] = [];
  for (const domain of active) {
    const byDay = new Map<string, { id: string; cosine: number }[]>();
    batch.forEach((paper, i) => {
      const cosine = dot(vectors[i], domain.centroid);
      if (cosine < floor || isExcluded(domain.excludes, paper.title, paper.abstract)) return;
      const list = byDay.get(paper.day) ?? [];
      list.push({ id: paper.id, cosine });
      byDay.set(paper.day, list);
    });
    for (const [day, candidates] of byDay) {
      const room = Math.max(0, TOP_PER_DOMAIN_DAY - (used.get(`${domain.id}|${day}`) ?? 0));
      const top = candidates.sort((a, b) => b.cosine - a.cosine).slice(0, room);
      for (const c of top) rows.push({ paper_id: c.id, domain_id: domain.id, cosine: c.cosine });
      if (top.length > 0) kept.push({ domainId: domain.id, day, count: top.length });
    }
  }

  const keptIds = new Set(rows.map((r) => r.paper_id));
  const droppedIds = batch.map((p) => p.id).filter((id) => !keptIds.has(id));

  for (let i = 0; i < rows.length; i += WRITE_CHUNK * 5) {
    await db.execute(sql`
      insert into research_signal.paper_domain (paper_id, domain_id, cosine)
      select r.paper_id, r.domain_id, r.cosine
      from jsonb_to_recordset(${JSON.stringify(rows.slice(i, i + WRITE_CHUNK * 5))}::jsonb)
        as r(paper_id uuid, domain_id int, cosine real)
      on conflict (paper_id, domain_id) do update set cosine = excluded.cosine`);
  }
  if (keptIds.size > 0) {
    await db
      .update(papers)
      .set({ status: "PREFILTERED" })
      .where(and(inArray(papers.id, [...keptIds]), eq(papers.status, "NEW")));
  }
  if (droppedIds.length > 0) {
    await db
      .update(papers)
      .set({ status: "DROPPED" })
      .where(and(inArray(papers.id, droppedIds), eq(papers.status, "NEW")));
  }

  if (keptIds.size > 0) await enqueue("embed2");
  if (!paperIds && batch.length === EMBED1_LIMIT) await enqueue("embed1");

  return { processed: batch.length, prefiltered: keptIds.size, dropped: droppedIds.length, kept };
}

export async function runEmbed2(): Promise<Embed2Result> {
  const batch = await db
    .select({
      id: papers.id,
      title: papers.title,
      abstract: papers.abstract,
      source: papers.source,
      publishedAt: sql<string | null>`coalesce(${papers.announcedAt}, ${papers.submittedAt})`,
    })
    .from(papers)
    .where(eq(papers.status, "PREFILTERED"))
    .orderBy(asc(papers.createdAt))
    .limit(EMBED2_LIMIT);
  if (batch.length === 0) return { shortlisted: 0, remaining: false };

  const vectors = await embedParallel(
    batch.map((p) => pass2Text(p.title, p.abstract)),
    "embed2",
  );
  const ids = batch.map((p) => p.id);

  for (let i = 0; i < batch.length; i += WRITE_CHUNK) {
    const chunk = batch.slice(i, i + WRITE_CHUNK).map((p, j) => ({
      id: p.id,
      embedding: `[${vectors[i + j].join(",")}]`,
    }));
    await db.execute(sql`
      update research_signal.papers p
      set embedding = r.embedding::extensions.halfvec(768)
      from jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) as r(id uuid, embedding text)
      where p.id = r.id`);
  }

  // Both vectors are unit length, so the negated inner product is the cosine.
  const domainRows = await db.execute<{ paper_id: string; domain_ids: number[] }>(sql`
    with updated as (
      update research_signal.paper_domain pd
      set cosine = (-(p.embedding <#> d.centroid))::real
      from research_signal.papers p, research_signal.domains d
      where pd.paper_id = p.id and pd.domain_id = d.id
        and d.centroid is not null and p.embedding is not null
        and p.id in ${ids}
      returning pd.paper_id, pd.domain_id
    )
    select paper_id, array_agg(domain_id order by domain_id) as domain_ids
    from updated group by paper_id`);
  const domainIds = new Map(domainRows.map((r) => [r.paper_id, r.domain_ids.map(Number)]));

  await upsertSearchDocs(
    batch.map((p, i) => ({
      entityType: "paper" as const,
      entityId: p.id,
      paperId: p.id,
      title: p.title,
      body: p.abstract,
      embedding: vectors[i],
      facets: {
        domainIds: domainIds.get(p.id) ?? [],
        source: p.source,
        publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
      },
    })),
  );

  await db
    .update(papers)
    .set({ status: "SHORTLISTED" })
    .where(and(inArray(papers.id, ids), eq(papers.status, "PREFILTERED")));
  await enqueue("score");

  const [more] = await db
    .select({ id: papers.id })
    .from(papers)
    .where(and(eq(papers.status, "PREFILTERED"), isNull(papers.embedding)))
    .limit(1);
  if (more) await enqueue("embed2");
  return { shortlisted: batch.length, remaining: Boolean(more) };
}
