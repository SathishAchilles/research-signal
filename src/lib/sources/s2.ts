import { z } from "zod";
import {
  type SourceAdapter,
  SourceUnavailable,
  TEST_TIMEOUT_MS,
  USER_AGENT,
  errorMessage,
  sleep,
  timed,
} from "./types";

const FIELDS = "title,venue,publicationVenue,citationCount,externalIds,references.title,references.citationCount";
const BATCH_URL = `https://api.semanticscholar.org/graph/v1/paper/batch?fields=${FIELDS}`;
const MAX_IDS = 500;
const RETRY_DELAYS_S = [4, 8, 16];
const JITTER = 0.2;

export type S2Reference = { paperId: string | null; title: string; citationCount: number | null };

export type S2Paper = {
  arxivId: string;
  paperId: string;
  title: string;
  venue: string | null;
  publicationVenue: string | null;
  citationCount: number | null;
  buildsOn: S2Reference[];
};

type RawPaper = {
  paperId?: string;
  title?: string;
  venue?: string;
  publicationVenue?: { name?: string } | null;
  citationCount?: number;
  references?: { paperId?: string | null; title?: string; citationCount?: number | null }[];
} | null;

class Retryable extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export const S2_THROTTLED = "throttled (anonymous pool)";
const TEST_RETRY_S = 4;
const MIN_TEST_REQUEST_MS = 3000;

const jittered = (seconds: number) => seconds * 1000 * (1 + (Math.random() * 2 - 1) * JITTER);

// Anonymous request: no API key header is ever sent (D8).
async function post(ids: string[], timeoutMs: number): Promise<RawPaper[]> {
  let response: Response;
  try {
    response = await fetch(BATCH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify({ ids: ids.map((id) => `arXiv:${id}`) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Retryable(errorMessage(error));
  }
  if (response.status === 429 || response.status >= 500) throw new Retryable(`HTTP ${response.status}`, response.status);
  if (!response.ok) throw new Error(`Semantic Scholar batch failed: HTTP ${response.status}`);
  return (await response.json()) as RawPaper[];
}

function topReferences(raw: NonNullable<RawPaper>): S2Reference[] {
  return (raw.references ?? [])
    .filter((r) => r.title)
    .map((r) => ({ paperId: r.paperId ?? null, title: r.title!, citationCount: r.citationCount ?? null }))
    .sort((a, b) => (b.citationCount ?? -1) - (a.citationCount ?? -1))
    .slice(0, 2);
}

async function lookupChunk(ids: string[]): Promise<S2Paper[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = await post(ids, 30_000);
      return raw.flatMap((paper, i) =>
        paper?.paperId
          ? [
              {
                arxivId: ids[i],
                paperId: paper.paperId,
                title: paper.title ?? "",
                venue: paper.venue?.trim() || null,
                publicationVenue: paper.publicationVenue?.name?.trim() || null,
                citationCount: paper.citationCount ?? null,
                buildsOn: topReferences(paper),
              },
            ]
          : [],
      );
    } catch (error) {
      if (!(error instanceof Retryable)) throw error;
      if (attempt >= RETRY_DELAYS_S.length) {
        throw new SourceUnavailable("s2", `${error.message} after ${RETRY_DELAYS_S.length} retries`);
      }
      await sleep(jittered(RETRY_DELAYS_S[attempt]));
    }
  }
}

export type S2Lookup = S2Paper[] & { error?: string };

// Stops at the first failing chunk. If an earlier chunk succeeded, its papers are returned with
// `error` set; if none did, the error is thrown.
export async function batchLookup(arxivIds: string[]): Promise<S2Lookup> {
  const ids = [...new Set(arxivIds)];
  const out: S2Paper[] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS) {
    try {
      out.push(...(await lookupChunk(ids.slice(i, i + MAX_IDS))));
    } catch (error) {
      if (i === 0) throw error;
      return Object.assign(out, { error: `${errorMessage(error)} (ids ${i + 1}-${ids.length} not looked up)` });
    }
  }
  return out;
}

const paramsSchema = z.object({
  batchSize: z.number().int().positive().max(MAX_IDS).default(MAX_IDS),
  retryDelaysSeconds: z.array(z.number().positive()).default(RETRY_DELAYS_S),
  jitter: z.number().min(0).max(1).default(JITTER),
});

export const s2Adapter: SourceAdapter<z.infer<typeof paramsSchema>> = {
  kind: "s2",
  paramsSchema,
  // The anonymous pool is shared, so one 429 gets a single jittered retry and a second one is
  // reported as throttled rather than as a failure.
  testConnection: () =>
    timed(async () => {
      const started = Date.now();
      try {
        const [paper] = await post(["1706.03762"], TEST_TIMEOUT_MS / 2);
        return paper?.title;
      } catch (error) {
        if (!(error instanceof Retryable && error.status === 429)) throw error;
      }
      await sleep(jittered(TEST_RETRY_S));
      try {
        const timeoutMs = Math.max(MIN_TEST_REQUEST_MS, TEST_TIMEOUT_MS - (Date.now() - started));
        const [paper] = await post(["1706.03762"], timeoutMs);
        return paper?.title;
      } catch (error) {
        if (error instanceof Retryable && error.status === 429) return S2_THROTTLED;
        throw error;
      }
    }),
};
