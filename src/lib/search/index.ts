import { createHash } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { actionKind, entityType, rung, searchDocs } from "@/db/schema";
import { embedTexts } from "@/lib/llm/embed";

export type EntityType = (typeof entityType.enumValues)[number];
export type Rung = (typeof rung.enumValues)[number];
export type ActionKind = (typeof actionKind.enumValues)[number];

export type SearchFacets = {
  domainIds?: number[];
  source?: string | null;
  rung?: Rung | null;
  venueStatus?: string | null;
  userAction?: ActionKind | null;
  hasCode?: boolean;
  publishedAt?: Date | null;
  attention?: number | null;
};

export type SearchDocInput = {
  entityType: EntityType;
  entityId: string;
  paperId?: string | null;
  title: string;
  body: string;
  facets?: SearchFacets;
  // A precomputed unit 768-d vector for this text (e.g. the paper's stored embedding).
  embedding?: number[] | null;
};

export type UpsertResult = { entityType: EntityType; entityId: string; embedded: boolean };

const STAGE = "search_index";
const MAX_EMBED_CHARS = 8000;

const keyOf = (type: string, id: string) => `${type}\u0000${id}`;

export function contentHash(title: string, body: string): string {
  return createHash("sha256").update(`${title}\n${body}`).digest("hex");
}

/**
 * Upserts rows into research_signal.search_docs, keyed by (entityType, entityId).
 * Text is re-embedded only when sha256(title, body) changed or no embedding is stored;
 * a supplied `embedding` is used instead of calling the embedding model.
 * Facets left undefined keep their stored value on update.
 */
export async function upsertSearchDocs(docs: SearchDocInput[]): Promise<UpsertResult[]> {
  if (docs.length === 0) return [];

  const existing = await db
    .select({
      entityType: searchDocs.entityType,
      entityId: searchDocs.entityId,
      contentHash: searchDocs.contentHash,
      hasEmbedding: sql<boolean>`${searchDocs.embedding} is not null`,
    })
    .from(searchDocs)
    .where(
      or(
        ...docs.map((d) =>
          and(eq(searchDocs.entityType, d.entityType), eq(searchDocs.entityId, d.entityId)),
        ),
      ),
    );
  const stored = new Map(existing.map((r) => [keyOf(r.entityType, r.entityId), r]));

  const prepared = docs.map((doc) => {
    const hash = contentHash(doc.title, doc.body);
    const prev = stored.get(keyOf(doc.entityType, doc.entityId));
    const unchanged = prev?.contentHash === hash && prev.hasEmbedding;
    return { doc, hash, needsEmbedding: !unchanged && !doc.embedding };
  });

  const toEmbed = prepared.filter((p) => p.needsEmbedding);
  const vectors = await embedTexts(
    toEmbed.map((p) => `${p.doc.title}\n\n${p.doc.body}`.slice(0, MAX_EMBED_CHARS)),
    STAGE,
  );
  const fresh = new Map(toEmbed.map((p, i) => [p, vectors[i]]));

  for (const p of prepared) {
    const { doc, hash } = p;
    const facets = doc.facets ?? {};
    const embedding = fresh.get(p) ?? doc.embedding ?? undefined;
    const textChanged = embedding !== undefined;
    const values = {
      paperId: doc.paperId ?? undefined,
      title: doc.title,
      body: doc.body,
      domainIds: facets.domainIds,
      source: facets.source,
      rung: facets.rung,
      venueStatus: facets.venueStatus,
      userAction: facets.userAction,
      hasCode: facets.hasCode,
      publishedAt: facets.publishedAt,
      attention: facets.attention,
      ...(textChanged ? { embedding, contentHash: hash } : {}),
    };
    await db
      .insert(searchDocs)
      .values({ entityType: doc.entityType, entityId: doc.entityId, ...values })
      .onConflictDoUpdate({ target: [searchDocs.entityType, searchDocs.entityId], set: values });
  }

  return prepared.map((p) => ({
    entityType: p.doc.entityType,
    entityId: p.doc.entityId,
    embedded: p.needsEmbedding,
  }));
}

export async function upsertSearchDoc(doc: SearchDocInput): Promise<UpsertResult> {
  const [result] = await upsertSearchDocs([doc]);
  return result;
}

// Facets that describe the paper (action, attention, rung, ...) on every doc tied to it.
export async function setPaperSearchFacets(paperIds: string[], facets: SearchFacets): Promise<void> {
  const set = Object.fromEntries(Object.entries(facets).filter(([, v]) => v !== undefined));
  if (paperIds.length === 0 || Object.keys(set).length === 0) return;
  await db.update(searchDocs).set(set).where(inArray(searchDocs.paperId, paperIds));
}

export async function deleteSearchDoc(type: EntityType, entityId: string): Promise<void> {
  await db
    .delete(searchDocs)
    .where(and(eq(searchDocs.entityType, type), eq(searchDocs.entityId, entityId)));
}

const SUMMARY_LIMIT = 300;

type SummaryRow = {
  paper_id: string;
  title: string;
  signal_type: string;
  client_angle: string | null;
  domain_ids: number[];
  source: string;
  published_at: string | Date | null;
};

export function summaryBody(signalType: string, clientAngle: string | null): string {
  const angle = clientAngle?.trim();
  return [`Signal: ${signalType}`, angle ? `Client angle: ${angle}` : null].filter(Boolean).join("\n");
}

/**
 * Upserts one 'summary' doc per scored paper: its signal type and client angle, from the paper's best
 * domain row. It covers the given papers plus, up to SUMMARY_LIMIT, scored papers whose summary is missing
 * or not yet embedded, so a failed run is healed by the next one. Rung, attention, verdict and has_code
 * are filled by the search_docs triggers from 007_search_verdict.sql.
 */
export async function indexPaperSummaries(paperIds: string[] = []): Promise<UpsertResult[]> {
  const ids = `{${paperIds.join(",")}}`;
  const rows = await db.execute<SummaryRow>(sql`
    with targets as (
      select unnest(${ids}::uuid[]) as paper_id
      union
      (select pd.paper_id
       from research_signal.paper_domain pd
       left join research_signal.search_docs d
         on d.entity_type = 'summary' and d.entity_id = pd.paper_id::text
       where pd.scored_at is not null and pd.signal_type is not null
         and (d.id is null or d.embedding is null)
       limit ${SUMMARY_LIMIT})
    )
    select p.id as paper_id, p.title, s.signal_type, s.client_angle, s.domain_ids, p.source,
      coalesce(p.announced_at, p.submitted_at) as published_at
    from targets t
    join research_signal.papers p on p.id = t.paper_id
    join lateral (
      select
        (array_agg(pd.signal_type order by pd.final_score desc nulls last, pd.cosine desc nulls last))[1]::text as signal_type,
        (array_agg(pd.client_angle order by pd.final_score desc nulls last, pd.cosine desc nulls last))[1] as client_angle,
        array_agg(pd.domain_id order by pd.domain_id) as domain_ids
      from research_signal.paper_domain pd
      where pd.paper_id = p.id and pd.scored_at is not null and pd.signal_type is not null
    ) s on s.signal_type is not null`);
  return upsertSearchDocs(
    rows.map((r) => ({
      entityType: "summary" as const,
      entityId: r.paper_id,
      paperId: r.paper_id,
      title: r.title,
      body: summaryBody(r.signal_type, r.client_angle),
      facets: {
        domainIds: r.domain_ids.map(Number),
        source: r.source,
        publishedAt: r.published_at === null ? null : new Date(r.published_at),
      },
    })),
  );
}
