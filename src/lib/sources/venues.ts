import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { papers, sources } from "@/db/schema";
import { fetchNew as fetchAcl } from "./acl";
import { fetchNew as fetchCvf } from "./cvf";
import { insertSignals } from "./hf";
import { jaccard, normalizeTitle, titleTokens } from "./openreview";
import { fetchNew as fetchPmlr } from "./pmlr";
import { finishRun, startRun } from "./runs";
import { SourceUnavailable, errorMessage } from "./types";

export type VenueKind = "acl" | "cvf" | "pmlr";
export const VENUE_KINDS: VenueKind[] = ["acl", "cvf", "pmlr"];

export type VenuePaper = {
  source: VenueKind;
  venue: string;
  title: string;
  abstract: string;
  authors: string[];
  url: string;
  pdfUrl: string | null;
  doi: string | null;
  publishedAt: Date | null;
};

export type VenueCursor = Record<string, unknown>;

export type VenueUpsertResult = { inserted: number; linked: number; skipped: number };

const MATCH_JACCARD = 0.9;
const RAREST_TOKENS = 4;
const INSERT_CHUNK = 500;

type Candidate = { id: string; source: string; titleNorm: string; tokens: Set<string> };

class TitleIndex {
  private exact = new Map<string, Candidate[]>();
  private postings = new Map<string, Candidate[]>();

  add(c: Candidate) {
    this.exact.set(c.titleNorm, [...(this.exact.get(c.titleNorm) ?? []), c]);
    for (const token of c.tokens) {
      const list = this.postings.get(token);
      if (list) list.push(c);
      else this.postings.set(token, [c]);
    }
  }

  // Exact title_norm first, then the best token Jaccard >= 0.9; arXiv rows are preferred in both.
  // Candidates come from the query's rarest tokens, which a 0.9 match almost always shares.
  find(titleNorm: string): Candidate | undefined {
    const exact = this.exact.get(titleNorm);
    if (exact?.length) return exact.find((c) => c.source === "arxiv") ?? exact[0];
    const tokens = titleTokens(titleNorm);
    const rarest = [...tokens]
      .sort((a, b) => (this.postings.get(a)?.length ?? 0) - (this.postings.get(b)?.length ?? 0))
      .slice(0, RAREST_TOKENS);
    let best: { c: Candidate; score: number; arxiv: boolean } | undefined;
    const seen = new Set<string>();
    for (const token of rarest) {
      for (const c of this.postings.get(token) ?? []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const score = jaccard(tokens, c.tokens);
        if (score < MATCH_JACCARD) continue;
        const arxiv = c.source === "arxiv";
        if (!best || (arxiv && !best.arxiv) || (arxiv === best.arxiv && score > best.score)) best = { c, score, arxiv };
      }
    }
    return best?.c;
  }
}

async function buildIndex(batchNorms: string[]): Promise<TitleIndex> {
  const rows = await db.execute<{ id: string; source: string; title_norm: string }>(sql`
    select id, source, title_norm from research_signal.papers
    where coalesce(submitted_at, created_at) > now() - interval '2 years'
       or title_norm in (select jsonb_array_elements_text(${JSON.stringify(batchNorms)}::jsonb))`);
  const index = new TitleIndex();
  for (const row of rows) {
    index.add({ id: row.id, source: row.source, titleNorm: row.title_norm, tokens: titleTokens(row.title_norm) });
  }
  return index;
}

// A venue paper whose title matches an existing paper becomes a venue signal on that paper;
// a repeat of an already stored venue paper is skipped; anything else is inserted.
export async function upsertVenuePapers(input: VenuePaper[]): Promise<VenueUpsertResult> {
  const unique = new Map<string, VenuePaper & { titleNorm: string }>();
  for (const paper of input) {
    const titleNorm = normalizeTitle(paper.title);
    if (titleNorm && !unique.has(titleNorm)) unique.set(titleNorm, { ...paper, titleNorm });
  }
  const batch = [...unique.values()];
  if (batch.length === 0) return { inserted: 0, linked: 0, skipped: 0 };

  const index = await buildIndex(batch.map((p) => p.titleNorm));
  const toInsert: (typeof papers.$inferInsert)[] = [];
  const toLink = new Map<string, string>();
  let skipped = 0;

  for (const paper of batch) {
    const match = index.find(paper.titleNorm);
    if (match && !VENUE_KINDS.includes(match.source as VenueKind)) {
      toLink.set(match.id, paper.venue);
    } else if (match) {
      skipped++;
    } else {
      toInsert.push({
        source: paper.source,
        title: paper.title,
        abstract: paper.abstract,
        authors: paper.authors,
        doi: paper.doi,
        submittedAt: paper.publishedAt,
        announcedAt: paper.publishedAt,
        urlAbs: paper.url,
        urlPdf: paper.pdfUrl,
        status: "NEW",
        titleNorm: paper.titleNorm,
      });
    }
  }

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
    const rows = await db
      .insert(papers)
      .values(toInsert.slice(i, i + INSERT_CHUNK))
      .onConflictDoNothing()
      .returning({ id: papers.id });
    inserted += rows.length;
  }
  skipped += toInsert.length - inserted;

  let linked = 0;
  if (toLink.size > 0) {
    const current = await db.execute<{ paper_id: string; venue: string | null }>(sql`
      select paper_id, venue from research_signal.latest_signals
      where paper_id in (select jsonb_array_elements_text(${JSON.stringify([...toLink.keys()])}::jsonb)::uuid)`);
    const already = new Map(current.map((r) => [r.paper_id, r.venue]));
    const fresh = [...toLink].filter(([id, venue]) => already.get(id) !== venue);
    skipped += toLink.size - fresh.length;
    linked = await insertSignals(fresh.map(([paperId, venue]) => ({ paperId, venue })));
  }

  return { inserted, linked, skipped };
}

export async function getVenueCursor(kind: VenueKind): Promise<VenueCursor | null> {
  const [row] = await db.select({ cursor: sources.cursor }).from(sources).where(eq(sources.kind, kind));
  return row?.cursor ?? null;
}

export async function saveVenueCursor(kind: VenueKind, cursor: VenueCursor): Promise<void> {
  await db.update(sources).set({ cursor }).where(eq(sources.kind, kind));
}

const FETCHERS: Record<VenueKind, (cursor: VenueCursor | null) => Promise<{ papers: VenuePaper[]; cursor: VenueCursor }>> = {
  acl: fetchAcl,
  cvf: fetchCvf,
  pmlr: fetchPmlr,
};

export type VenueSyncResult = VenueUpsertResult & {
  kind: VenueKind;
  status: "OK" | "PARTIAL" | "FAILED";
  fetched: number;
  cursor: VenueCursor | null;
  error?: string;
};

// Runs each enabled venue source once, records a source_runs row and stores the new cursor.
export async function syncVenues(stage = "weekly"): Promise<VenueSyncResult[]> {
  const enabled = await db
    .select({ kind: sources.kind })
    .from(sources)
    .where(and(eq(sources.enabled, true), inArray(sources.kind, VENUE_KINDS)));
  const results: VenueSyncResult[] = [];
  for (const kind of VENUE_KINDS.filter((k) => enabled.some((e) => e.kind === k))) {
    const runId = await startRun(kind, stage);
    const cursor = await getVenueCursor(kind);
    try {
      const fetched = await FETCHERS[kind](cursor);
      const counts = await upsertVenuePapers(fetched.papers);
      await saveVenueCursor(kind, fetched.cursor);
      await finishRun(runId, "OK", counts.inserted + counts.linked);
      results.push({ kind, status: "OK", fetched: fetched.papers.length, cursor: fetched.cursor, ...counts });
    } catch (error) {
      const status = error instanceof SourceUnavailable ? "PARTIAL" : "FAILED";
      await finishRun(runId, status, 0, errorMessage(error));
      results.push({ kind, status, fetched: 0, cursor, inserted: 0, linked: 0, skipped: 0, error: errorMessage(error) });
    }
  }
  return results;
}
