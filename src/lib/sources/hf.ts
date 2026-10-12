import { sql } from "drizzle-orm";
import pLimit from "p-limit";
import { z } from "zod";
import { db } from "@/db/client";
import { type SourceAdapter, SourceUnavailable, TEST_TIMEOUT_MS, errorMessage, httpGet, sleep, timed } from "./types";

const API = "https://huggingface.co/api";
const DAILY_LIMIT = 100;
const DETAIL_CONCURRENCY = 5;
const DEFAULT_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 60_000;

export type HfDaily = {
  arxivId: string;
  date: string;
  title: string;
  upvotes: number | null;
  numComments: number | null;
  githubRepo: string | null;
  githubStars: number | null;
};

export type HfDetail = {
  arxivId: string;
  title: string;
  upvotes: number | null;
  githubRepo: string | null;
  githubStars: number | null;
  linkedModels: number | null;
  linkedSpaces: number | null;
};

type HfPaper = {
  id?: string;
  title?: string;
  upvotes?: number;
  githubRepo?: string;
  githubStars?: number;
  numTotalModels?: number;
  numTotalSpaces?: number;
  linkedModels?: unknown[];
  linkedSpaces?: unknown[];
};

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function authHeaders(token?: string): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

class RateLimited extends SourceUnavailable {
  constructor(readonly retryAfterMs: number) {
    super("hf", "HTTP 429");
  }
}

function retryAfterMs(header: string | null): number {
  const seconds = Number(header);
  if (header && Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 1000), MAX_BACKOFF_MS);
  const at = header ? Date.parse(header) : NaN;
  return Number.isNaN(at) ? DEFAULT_BACKOFF_MS : Math.min(Math.max(at - Date.now(), 1000), MAX_BACKOFF_MS);
}

async function getJson<T>(url: string, token?: string, timeoutMs?: number): Promise<T | null> {
  const response = await httpGet(url, authHeaders(token), timeoutMs);
  if (response.status === 404) return null;
  if (response.status === 429) throw new RateLimited(retryAfterMs(response.headers.get("retry-after")));
  if (!response.ok) throw new Error(`Hugging Face request failed: HTTP ${response.status} for ${url}`);
  return (await response.json()) as T;
}

export async function fetchDaily(dates: string[], token?: string): Promise<HfDaily[]> {
  const out: HfDaily[] = [];
  for (const date of dates) {
    const items =
      (await getJson<{ paper?: HfPaper; numComments?: number }[]>(
        `${API}/daily_papers?date=${encodeURIComponent(date)}&limit=${DAILY_LIMIT}`,
        token,
      )) ?? [];
    for (const item of items) {
      const paper = item.paper;
      if (!paper?.id) continue;
      out.push({
        arxivId: paper.id,
        date,
        title: paper.title ?? "",
        upvotes: int(paper.upvotes),
        numComments: int(item.numComments),
        githubRepo: str(paper.githubRepo),
        githubStars: int(paper.githubStars),
      });
    }
  }
  return out;
}

function toDetail(arxivId: string, paper: HfPaper): HfDetail {
  return {
    arxivId,
    title: paper.title ?? "",
    upvotes: int(paper.upvotes),
    githubRepo: str(paper.githubRepo),
    githubStars: int(paper.githubStars),
    linkedModels: int(paper.numTotalModels) ?? paper.linkedModels?.length ?? null,
    linkedSpaces: int(paper.numTotalSpaces) ?? paper.linkedSpaces?.length ?? null,
  };
}

export type HfDetails = HfDetail[] & { failed: number };

// Papers that Hugging Face does not list (404) are left out of the result. A failed request is
// counted in `failed`; only when every request fails is SourceUnavailable thrown. A 429 pauses all
// workers for its Retry-After and the paper is retried once.
export async function fetchDetail(arxivIds: string[], token?: string): Promise<HfDetails> {
  const limit = pLimit(DETAIL_CONCURRENCY);
  let pausedUntil = 0;
  const get = async (id: string) => {
    for (let attempt = 0; ; attempt++) {
      const pause = pausedUntil - Date.now();
      if (pause > 0) await sleep(pause);
      try {
        return await getJson<HfPaper>(`${API}/papers/${encodeURIComponent(id)}`, token);
      } catch (error) {
        if (!(error instanceof RateLimited) || attempt > 0) throw error;
        pausedUntil = Math.max(pausedUntil, Date.now() + error.retryAfterMs);
      }
    }
  };
  const settled = await Promise.allSettled(
    arxivIds.map((id) =>
      limit(async () => {
        const paper = await get(id);
        return paper ? toDetail(id, paper) : null;
      }),
    ),
  );

  const details: HfDetail[] = [];
  const errors: unknown[] = [];
  for (const result of settled) {
    if (result.status === "rejected") errors.push(result.reason);
    else if (result.value) details.push(result.value);
  }
  if (errors.length > 0 && errors.length === arxivIds.length) {
    throw new SourceUnavailable("hf", `all ${errors.length} detail requests failed: ${errorMessage(errors[0])}`, {
      cause: errors[0],
    });
  }
  if (errors.length > 0) console.warn(`hf detail: ${errors.length} of ${arxivIds.length} requests failed`);
  return Object.assign(details, { failed: errors.length });
}

export type SignalInput = {
  arxivId?: string;
  paperId?: string;
  hfUpvotes?: number | null;
  hfComments?: number | null;
  githubRepo?: string | null;
  githubStars?: number | null;
  linkedModels?: number | null;
  linkedSpaces?: number | null;
  orVenue?: string | null;
  orDecision?: string | null;
  s2Citations?: number | null;
  buildsOn?: unknown;
  venue?: string | null;
};

// Each snapshot is merged with the paper's latest one, so the latest row stays complete
// and a partial update (for example a venue-only row) does not hide earlier values.
export async function insertSignals(rows: SignalInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const records = rows.map((r) => ({
    arxiv_id: r.arxivId ?? null,
    paper_id: r.paperId ?? null,
    hf_upvotes: r.hfUpvotes ?? null,
    hf_comments: r.hfComments ?? null,
    github_repo: r.githubRepo ?? null,
    github_stars: r.githubStars ?? null,
    linked_models: r.linkedModels ?? null,
    linked_spaces: r.linkedSpaces ?? null,
    or_venue: r.orVenue ?? null,
    or_decision: r.orDecision ?? null,
    s2_citations: r.s2Citations ?? null,
    builds_on: r.buildsOn ?? null,
    venue: r.venue ?? null,
  }));
  const inserted = await db.execute(sql`
    insert into research_signal.signals (
      paper_id, hf_upvotes, hf_comments, github_repo, github_stars, linked_models, linked_spaces,
      or_venue, or_decision, s2_citations, builds_on, venue
    )
    select
      p.id,
      coalesce(r.hf_upvotes, ls.hf_upvotes),
      coalesce(r.hf_comments, ls.hf_comments),
      coalesce(r.github_repo, ls.github_repo),
      coalesce(r.github_stars, ls.github_stars),
      coalesce(r.linked_models, ls.linked_models),
      coalesce(r.linked_spaces, ls.linked_spaces),
      coalesce(r.or_venue, ls.or_venue),
      coalesce(r.or_decision, ls.or_decision),
      coalesce(r.s2_citations, ls.s2_citations),
      coalesce(r.builds_on, ls.builds_on),
      coalesce(r.venue, ls.venue)
    from jsonb_to_recordset(${JSON.stringify(records)}::jsonb) as r(
      arxiv_id text, paper_id uuid, hf_upvotes int, hf_comments int, github_repo text,
      github_stars int, linked_models int, linked_spaces int, or_venue text, or_decision text,
      s2_citations int, builds_on jsonb, venue text
    )
    join research_signal.papers p on p.id = r.paper_id or (r.paper_id is null and p.arxiv_id = r.arxiv_id)
    left join research_signal.latest_signals ls on ls.paper_id = p.id
    returning paper_id`);
  return inserted.length;
}

// Writes one snapshot per paper that already exists; unknown arXiv ids are skipped.
export async function writeHfSignals(rows: (HfDaily | HfDetail)[]): Promise<number> {
  const byId = new Map<string, SignalInput>();
  for (const row of rows) {
    const prev = byId.get(row.arxivId);
    byId.set(row.arxivId, {
      arxivId: row.arxivId,
      hfUpvotes: row.upvotes ?? prev?.hfUpvotes,
      githubRepo: row.githubRepo ?? prev?.githubRepo,
      githubStars: row.githubStars ?? prev?.githubStars,
      hfComments: ("numComments" in row ? row.numComments : null) ?? prev?.hfComments,
      linkedModels: ("linkedModels" in row ? row.linkedModels : null) ?? prev?.linkedModels,
      linkedSpaces: ("linkedSpaces" in row ? row.linkedSpaces : null) ?? prev?.linkedSpaces,
    });
  }
  return insertSignals([...byId.values()]);
}

const paramsSchema = z.object({
  dailyDays: z.number().int().positive().default(3),
  dailyLimit: z.number().int().positive().max(DAILY_LIMIT).default(DAILY_LIMIT),
  detailConcurrency: z.number().int().positive().default(DETAIL_CONCURRENCY),
});

export const hfAdapter: SourceAdapter<z.infer<typeof paramsSchema>> = {
  kind: "hf",
  paramsSchema,
  testConnection: (_params, secret) =>
    timed(async () => {
      const items = await getJson<{ paper?: HfPaper }[]>(`${API}/daily_papers?limit=1`, secret, TEST_TIMEOUT_MS);
      return items?.[0]?.paper?.title;
    }),
};
