import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { actionKind, rung, verdict } from "@/db/schema";
import { embedTexts } from "@/lib/llm/embed";
import type { EntityType } from "./index";

export const searchFiltersSchema = z
  .object({
    domainId: z.number().int().positive(),
    since: z.iso.datetime({ offset: true }).or(z.iso.date()),
    until: z.iso.datetime({ offset: true }).or(z.iso.date()),
    source: z.string().min(1),
    minRung: z.enum(rung.enumValues),
    verdict: z.enum(verdict.enumValues),
    action: z.enum(actionKind.enumValues),
    hasCode: z.boolean(),
  })
  .partial()
  .strict();

export type SearchFilters = z.infer<typeof searchFiltersSchema>;
export type SearchSort = "relevance" | "date" | "attention";
export const SEARCH_SORTS = ["relevance", "date", "attention"] as const satisfies SearchSort[];

export type SearchHit = {
  id: number;
  entityType: EntityType;
  entityId: string;
  paperId: string | null;
  title: string;
  publishedAt: string | null;
  attention: number | null;
  score: number;
  // Cosine similarity of the hit to the query; null for full-text-only hits and empty queries.
  similarity: number | null;
};

type HitRow = {
  id: string | number;
  entity_type: EntityType;
  entity_id: string;
  paper_id: string | null;
  title: string;
  published_at: string | Date | null;
  attention: string | number | null;
  score: string | number;
  similarity?: string | number | null;
};

const STAGE = "search_query";
export const MAX_SEARCH_LIMIT = 100;

const toIso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());
const time = (v: string | null) => (v === null ? -Infinity : Date.parse(v));

export async function search({
  q = "",
  filters = {},
  sort = "relevance",
  limit = 20,
}: {
  q?: string;
  filters?: SearchFilters;
  sort?: SearchSort;
  limit?: number;
}): Promise<SearchHit[]> {
  const text = q.trim();
  const count = Math.min(Math.max(1, Math.floor(limit)), MAX_SEARCH_LIMIT);
  const vector = text ? `[${(await embedTexts([text], STAGE))[0].join(",")}]` : null;
  const payload = text ? filters : { ...filters, sort: sort === "attention" ? "attention" : "published" };

  const rows = (await db.execute(
    sql`select * from research_signal.hybrid_search(${text || null}::text, ${vector}::extensions.halfvec(768), ${JSON.stringify(payload)}::jsonb, ${count}::int)`,
  )) as unknown as HitRow[];

  const hits: SearchHit[] = rows.map((r) => ({
    id: Number(r.id),
    entityType: r.entity_type,
    entityId: r.entity_id,
    paperId: r.paper_id,
    title: r.title,
    publishedAt: toIso(r.published_at),
    attention: r.attention === null ? null : Number(r.attention),
    score: Number(r.score),
    similarity: r.similarity === null || r.similarity === undefined ? null : Number(r.similarity),
  }));

  if (text && sort === "date") hits.sort((a, b) => time(b.publishedAt) - time(a.publishedAt));
  if (text && sort === "attention") {
    hits.sort((a, b) => (b.attention ?? -Infinity) - (a.attention ?? -Infinity));
  }
  return hits;
}
