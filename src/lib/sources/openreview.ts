import { z } from "zod";
import {
  type SourceAdapter,
  SourceUnavailable,
  TEST_TIMEOUT_MS,
  httpGet,
  sleep,
  timed,
} from "./types";

const SEARCH_URL = "https://api2.openreview.net/notes/search";
const MIN_INTERVAL_MS = 3100;
const MATCH_JACCARD = 0.9;

export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleTokens(s: string): Set<string> {
  const norm = normalizeTitle(s);
  return new Set(norm ? norm.split(" ") : []);
}

export function jaccard(a: string | Set<string>, b: string | Set<string>): number {
  const left = typeof a === "string" ? titleTokens(a) : a;
  const right = typeof b === "string" ? titleTokens(b) : b;
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / (left.size + right.size - shared);
}

export type VenueMatch = { venue?: string; venueid?: string; accepted: boolean };

type NoteField = string | { value?: unknown } | undefined;
type Note = { content?: { title?: NoteField; venue?: NoteField; venueid?: NoteField } };

function fieldText(field: NoteField): string | undefined {
  const value = typeof field === "object" && field !== null ? field.value : field;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// D7 counts a venueid without "Submitted"/"Withdrawn" as accepted. Rejected and desk-rejected
// ids end in "_Submission", and DBLP's CoRR mirror is arXiv itself, so neither counts.
export function isAccepted(venue?: string, venueid?: string): boolean {
  if (venueid && /dblp\.org\/journals\/corr/i.test(venueid)) return false;
  if (venue && /\b(accepted|oral|poster|spotlight)\b/i.test(venue)) return true;
  return Boolean(venueid && !/submi|withdrawn|reject/i.test(venueid));
}

let lastRequestAt = 0;

async function search(term: string, limit: number, timeoutMs?: number): Promise<Note[]> {
  const remaining = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (remaining > 0) await sleep(remaining);
  lastRequestAt = Date.now();

  const params = new URLSearchParams({ term, source: "forum", limit: String(limit) });
  const response = await httpGet(`${SEARCH_URL}?${params}`, {}, timeoutMs);
  if (response.status === 403 || response.status === 429) {
    throw new SourceUnavailable("openreview", `HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(`OpenReview search failed: HTTP ${response.status}`);
  const body = (await response.json()) as { notes?: Note[] };
  return body.notes ?? [];
}

export async function matchVenue(title: string): Promise<VenueMatch | null> {
  const wanted = titleTokens(title);
  const candidates = (await search(title, 5))
    .map((note) => {
      const venue = fieldText(note.content?.venue);
      const venueid = fieldText(note.content?.venueid);
      const similarity = jaccard(wanted, titleTokens(fieldText(note.content?.title) ?? ""));
      return { venue, venueid, accepted: isAccepted(venue, venueid), similarity };
    })
    .filter((c) => c.similarity >= MATCH_JACCARD && (c.venue || c.venueid));
  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) => Number(b.accepted) - Number(a.accepted) || b.similarity - a.similarity,
  );
  const { venue, venueid, accepted } = candidates[0];
  return { venue, venueid, accepted };
}

const paramsSchema = z.object({
  maxPerDay: z.number().int().positive().default(10),
  maxPerSunday: z.number().int().positive().default(15),
  minIntervalMs: z.number().int().positive().default(MIN_INTERVAL_MS),
  titleJaccard: z.number().min(0).max(1).default(MATCH_JACCARD),
});

export const openreviewAdapter: SourceAdapter<z.infer<typeof paramsSchema>> = {
  kind: "openreview",
  paramsSchema,
  testConnection: () =>
    timed(async () => {
      const [note] = await search("large language models", 1, TEST_TIMEOUT_MS);
      return fieldText(note?.content?.title);
    }),
};
