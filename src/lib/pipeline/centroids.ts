import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { domains } from "@/db/schema";
import { embedTexts } from "@/lib/llm/embed";

const STAGE = "centroid";
const BASE_WEIGHT = 0.6;
const CLIENT_WEIGHT = 0.4;
const MIN_CLIENT_FLAGS = 3;

export type CentroidResult = { domainId: number; clientFlags: number; blended: boolean };

type DomainRow = Pick<typeof domains.$inferSelect, "id" | "name" | "description" | "keywords">;

export function centroidText(domain: Pick<DomainRow, "name" | "description" | "keywords">): string {
  return `${domain.name}. ${domain.description}. Keywords: ${domain.keywords.join(", ")}`;
}

export function unit(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) throw new Error("Cannot normalise a zero vector");
  return v.map((x) => x / norm);
}

export function blendCentroid(base: number[], flagged: number[][]): number[] {
  if (flagged.length < MIN_CLIENT_FLAGS) return unit(base);
  const mean = base.map((_, i) => flagged.reduce((sum, v) => sum + v[i], 0) / flagged.length);
  return unit(base.map((x, i) => BASE_WEIGHT * x + CLIENT_WEIGHT * mean[i]));
}

// Embeddings of this domain's papers whose latest action is CLIENT within the last 26 weeks.
async function clientFlaggedEmbeddings(domainId: number): Promise<number[][]> {
  const rows = await db.execute<{ embedding: string }>(sql`
    select p.embedding::text as embedding
    from (
      select distinct on (a.paper_id) a.paper_id, a.action, a.created_at
      from research_signal.actions a
      order by a.paper_id, a.created_at desc, a.id desc
    ) latest
    join research_signal.papers p on p.id = latest.paper_id
    join research_signal.paper_domain pd on pd.paper_id = p.id and pd.domain_id = ${domainId}
    where latest.action = 'CLIENT'
      and latest.created_at >= now() - interval '26 weeks'
      and p.embedding is not null`);
  return rows.map((r) => JSON.parse(r.embedding) as number[]);
}

// Recomputes several centroids with one embedding request; defaults to every active domain.
export async function recomputeCentroids(domainIds?: number[]): Promise<CentroidResult[]> {
  const rows: DomainRow[] = await db
    .select({ id: domains.id, name: domains.name, description: domains.description, keywords: domains.keywords })
    .from(domains)
    .where(domainIds ? inArray(domains.id, domainIds) : eq(domains.active, true));
  if (rows.length === 0) return [];

  const bases = await embedTexts(rows.map(centroidText), STAGE);
  const results: CentroidResult[] = [];
  for (const [i, domain] of rows.entries()) {
    const flagged = await clientFlaggedEmbeddings(domain.id);
    const centroid = blendCentroid(bases[i], flagged);
    await db
      .update(domains)
      .set({ centroid, centroidUpdatedAt: sql`now()` })
      .where(eq(domains.id, domain.id));
    results.push({ domainId: domain.id, clientFlags: flagged.length, blended: flagged.length >= MIN_CLIENT_FLAGS });
  }
  return results;
}

export async function recomputeCentroid(domainId: number): Promise<CentroidResult | null> {
  const [result] = await recomputeCentroids([domainId]);
  return result ?? null;
}
