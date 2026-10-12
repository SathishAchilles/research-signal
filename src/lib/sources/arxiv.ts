import { sql } from "drizzle-orm";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { db } from "@/db/client";
import { papers } from "@/db/schema";
import { withArxivLease } from "./lease";
import { normalizeTitle } from "./openreview";
import { type SourceAdapter, TEST_TIMEOUT_MS, httpGet, timed } from "./types";

export const DEFAULT_CATEGORIES = ["cs.AI", "cs.CL", "cs.LG", "cs.CV", "cs.IR", "cs.SE"];
const RSS_URL = "https://rss.arxiv.org/rss/";
const EXPORT_URL = "https://export.arxiv.org/api/query";
const PAGE_SIZE = 2000;
// The arXiv API serves at most this many results for one query.
const API_RESULT_CAP = 30_000;
const UPSERT_CHUNK = 500;
const LEASE_WAIT_MS = 8000;
const MIN_TEST_REQUEST_MS = 3000;

export type ArxivItem = {
  arxivId: string;
  title: string;
  abstract: string;
  authors: string[];
  categories: string[];
  submittedAt?: Date;
  announcedAt?: Date;
  announceType?: "new" | "cross";
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  isArray: (name) => ["item", "entry", "category", "author", "link"].includes(name),
});

const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

export function stripVersion(id: string): string {
  return id.replace(/v\d+$/, "");
}

function idFrom(value: string): string {
  const match = value.match(/(?:arxiv\.org\/abs\/|oai:arXiv\.org:)(.+)$/i);
  return stripVersion((match ? match[1] : value).trim());
}

function toDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

type RssItem = {
  title?: string;
  link?: string;
  description?: string;
  guid?: string | { "#text"?: string };
  category?: string[];
  "arxiv:announce_type"?: string;
  "dc:creator"?: string;
};

export function parseRss(xml: string): ArxivItem[] {
  const channel = parser.parse(xml)?.rss?.channel;
  if (!channel) throw new Error("arXiv RSS response has no channel");
  const announcedAt = toDate(channel.pubDate);
  const items: ArxivItem[] = [];
  for (const item of (channel.item ?? []) as RssItem[]) {
    const announceType = clean(item["arxiv:announce_type"]);
    if (announceType !== "new" && announceType !== "cross") continue;
    const guid = typeof item.guid === "object" ? item.guid["#text"] : item.guid;
    const source = guid || item.link;
    if (!source) continue;
    const description = clean(item.description);
    items.push({
      arxivId: idFrom(source),
      title: clean(item.title),
      abstract: description.replace(/^.*?Abstract:\s*/, ""),
      authors: clean(item["dc:creator"])
        .split(/,\s*|\s+and\s+/)
        .map((a) => a.trim())
        .filter(Boolean),
      categories: (item.category ?? []).map(clean).filter(Boolean),
      announcedAt,
      announceType,
    });
  }
  return items;
}

type AtomEntry = {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  author?: { name?: string }[];
  category?: { "@_term"?: string }[];
};

export function parseAtom(xml: string): { items: ArxivItem[]; totalResults: number } {
  const feed = parser.parse(xml)?.feed;
  if (!feed) throw new Error("arXiv API response has no feed");
  const entries = (feed.entry ?? []) as AtomEntry[];
  const error = entries.find((e) => e.id?.includes("arxiv.org/api/errors"));
  if (error) throw new Error(`arXiv API error: ${clean(error.summary)}`);
  const items = entries
    .filter((e) => e.id)
    .map((e) => ({
      arxivId: idFrom(e.id!),
      title: clean(e.title),
      abstract: clean(e.summary),
      authors: (e.author ?? []).map((a) => clean(a.name)).filter(Boolean),
      categories: (e.category ?? []).map((c) => clean(c["@_term"])).filter(Boolean),
      submittedAt: toDate(e.published),
    }));
  return { items, totalResults: Number(feed["opensearch:totalResults"] ?? items.length) };
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function backstopUrl(categories: string[], fromDate: Date, toDate: Date, start: number, maxResults: number) {
  const cats = categories.map((c) => `cat:${c}`).join(" OR ");
  const params = new URLSearchParams({
    search_query: `(${cats}) AND submittedDate:[${ymd(fromDate)}0000 TO ${ymd(toDate)}2359]`,
    sortBy: "submittedDate",
    sortOrder: "descending",
    start: String(start),
    max_results: String(maxResults),
  });
  return `${EXPORT_URL}?${params}`;
}

// Callers hold the arXiv lease and pass its wait(), which spaces requests 3.1 s apart.
export async function fetchRssDelta(
  categories: string[],
  etag?: string,
  wait?: () => Promise<void>,
): Promise<{ items: ArxivItem[]; etag?: string; notModified: boolean }> {
  await wait?.();
  const response = await httpGet(`${RSS_URL}${categories.join("+")}`, etag ? { "if-none-match": etag } : {});
  if (response.status === 304) return { items: [], etag, notModified: true };
  if (!response.ok) throw new Error(`arXiv RSS failed: HTTP ${response.status}`);
  const items = parseRss(await response.text());
  return { items, etag: response.headers.get("etag") ?? undefined, notModified: false };
}

// One page of the submittedDate backstop, newest first.
export async function fetchBackstopPage(
  categories: string[],
  fromDate: Date,
  toDate: Date,
  start: number,
  wait?: () => Promise<void>,
): Promise<{ items: ArxivItem[]; totalResults: number }> {
  await wait?.();
  const response = await httpGet(backstopUrl(categories, fromDate, toDate, start, PAGE_SIZE), {}, 60_000);
  if (!response.ok) throw new Error(`arXiv API failed: HTTP ${response.status}`);
  return parseAtom(await response.text());
}

// Pages through every result in the window; each page goes through wait(), so pages stay 3.1 s apart.
// arXiv sometimes answers a page with no entries, so an empty page is retried once before stopping.
export async function fetchBackstop(
  categories: string[],
  fromDate: Date,
  toDate: Date,
  wait?: () => Promise<void>,
): Promise<ArxivItem[]> {
  const items: ArxivItem[] = [];
  let total = Infinity;
  for (let start = 0; start < Math.min(total, API_RESULT_CAP); start += PAGE_SIZE) {
    let page = await fetchBackstopPage(categories, fromDate, toDate, start, wait);
    if (page.items.length === 0 && (start > 0 || page.totalResults > 0)) {
      page = await fetchBackstopPage(categories, fromDate, toDate, start, wait);
    }
    if (start === 0) total = page.totalResults;
    items.push(...page.items);
    if (page.items.length === 0) break;
  }
  if (items.length < Math.min(total, API_RESULT_CAP) || total > API_RESULT_CAP) {
    console.warn(`arXiv backstop incomplete: ${total} results, fetched ${items.length}`);
  }
  return items;
}

function dedupe(items: ArxivItem[]): ArxivItem[] {
  const byId = new Map<string, ArxivItem>();
  for (const item of items) {
    const existing = byId.get(item.arxivId);
    byId.set(
      item.arxivId,
      existing
        ? {
            ...existing,
            ...item,
            submittedAt: existing.submittedAt ?? item.submittedAt,
            announcedAt: existing.announcedAt ?? item.announcedAt,
          }
        : item,
    );
  }
  return [...byId.values()].filter((item) => item.arxivId && item.title);
}

// Returns the number of newly inserted papers. Existing rows only gain a missing announced_at.
export async function upsertArxivItems(items: ArxivItem[]): Promise<number> {
  const rows = dedupe(items).map((item) => ({
    arxivId: item.arxivId,
    source: "arxiv",
    title: item.title,
    abstract: item.abstract,
    authors: item.authors,
    categories: item.categories,
    submittedAt: item.submittedAt ?? null,
    announcedAt: item.announcedAt ?? null,
    urlAbs: `https://arxiv.org/abs/${item.arxivId}`,
    urlPdf: `https://arxiv.org/pdf/${item.arxivId}`,
    urlHtml: `https://arxiv.org/html/${item.arxivId}`,
    status: "NEW" as const,
    titleNorm: normalizeTitle(item.title),
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const result = await db
      .insert(papers)
      .values(rows.slice(i, i + UPSERT_CHUNK))
      .onConflictDoUpdate({
        target: papers.arxivId,
        set: { announcedAt: sql`excluded.announced_at` },
        setWhere: sql`${papers.announcedAt} is null and excluded.announced_at is not null`,
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    inserted += result.filter((r) => r.inserted).length;
  }
  return inserted;
}

const paramsSchema = z.object({
  categories: z.array(z.string().min(1)).min(1).default(DEFAULT_CATEGORIES),
  backstopDays: z.number().int().positive().default(4),
});

export const arxivAdapter: SourceAdapter<z.infer<typeof paramsSchema>> = {
  kind: "arxiv",
  paramsSchema,
  // Waits up to LEASE_WAIT_MS for a running ingest to release the lease; the request gets what is
  // left of the test timeout.
  testConnection: (params) =>
    timed(async () => {
      const started = Date.now();
      const result = await withArxivLease(
        "test",
        async (wait) => {
          await wait();
          const query = new URLSearchParams({
            search_query: `cat:${params.categories[0] ?? "cs.AI"}`,
            sortBy: "submittedDate",
            sortOrder: "descending",
            max_results: "1",
          });
          const timeoutMs = Math.max(MIN_TEST_REQUEST_MS, TEST_TIMEOUT_MS - (Date.now() - started));
          const response = await httpGet(`${EXPORT_URL}?${query}`, {}, timeoutMs);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return parseAtom(await response.text()).items[0]?.title;
        },
        { maxWaitMs: LEASE_WAIT_MS },
      );
      if (result === "busy") throw new Error(`busy: arXiv lease still held by another run after ${LEASE_WAIT_MS / 1000} s`);
      return result;
    }),
};
