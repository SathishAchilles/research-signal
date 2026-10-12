import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import {
  type SourceAdapter,
  SourceUnavailable,
  TEST_TIMEOUT_MS,
  httpGet,
  stripTags,
  timed,
} from "./types";
import type { VenuePaper } from "./venues";

const API = "https://api.github.com/repos/acl-org/acl-anthology";
const RAW = "https://raw.githubusercontent.com/acl-org/acl-anthology/master/";
const FIRST_RUN_DAYS = 7;
const MAX_PRS = 10;
const MAX_FILES = 20;
// Unauthenticated GitHub allows 60 requests an hour, so the commit listing is capped.
const MAX_COMMIT_PAGES = 5;
const MAX_PR_FILE_PAGES = 5;
const PER_PAGE = 100;
const SEEN_PRS_KEPT = 100;

export type AclCursor = { since?: string; etag?: string; seenPrs?: number[] };

type Commit = { sha: string; commit: { message: string; committer?: { date?: string } } };
type PrFile = { filename: string; status: string };

const GITHUB_HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };

async function github(url: string, extra: Record<string, string> = {}, timeoutMs?: number): Promise<Response> {
  const response = await httpGet(url, { ...GITHUB_HEADERS, ...extra }, timeoutMs);
  if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
    throw new SourceUnavailable("acl", `GitHub rate limit (HTTP ${response.status})`);
  }
  if (!response.ok && response.status !== 304) throw new Error(`GitHub request failed: HTTP ${response.status}`);
  return response;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  stopNodes: ["*.title", "*.abstract", "*.booktitle"],
  isArray: (name) => ["volume", "paper", "author"].includes(name),
});

type Person = { first?: string; last?: string };
type XmlPaper = { "@_id"?: string; title?: string; abstract?: string; author?: Person[]; doi?: string };
type XmlVolume = { "@_id"?: string; meta?: { year?: string; month?: string }; paper?: XmlPaper[] };

function venueName(collectionId: string): { name: string; year: number } {
  const [year, acronym = collectionId] = collectionId.split(".");
  return { name: `${acronym.toUpperCase()} ${year}`, year: Number(year) };
}

export function parseAclXml(xml: string, minYear: number): VenuePaper[] {
  const collection = parser.parse(xml)?.collection;
  const collectionId: string | undefined = collection?.["@_id"];
  if (!collectionId) return [];
  const { name } = venueName(collectionId);
  const out: VenuePaper[] = [];
  for (const volume of (collection.volume ?? []) as XmlVolume[]) {
    const year = Number(volume.meta?.year ?? collectionId.slice(0, 4));
    if (!(year >= minYear)) continue;
    const month = volume.meta?.month ? Date.parse(`1 ${volume.meta.month} ${year}`) : NaN;
    for (const paper of volume.paper ?? []) {
      const title = stripTags(paper.title ?? "");
      if (!title || !paper["@_id"]) continue;
      const anthologyId = `${collectionId}-${volume["@_id"]}.${paper["@_id"]}`;
      out.push({
        source: "acl",
        venue: name,
        title,
        abstract: stripTags(paper.abstract ?? ""),
        authors: (paper.author ?? []).map((a) => [a.first, a.last].filter(Boolean).join(" ")).filter(Boolean),
        url: `https://aclanthology.org/${anthologyId}/`,
        pdfUrl: `https://aclanthology.org/${anthologyId}.pdf`,
        doi: typeof paper.doi === "string" && paper.doi.trim() ? paper.doi.trim() : null,
        publishedAt: new Date(Number.isNaN(month) ? Date.UTC(year, 0, 1) : month),
      });
    }
  }
  return out;
}

async function prFiles(pr: number): Promise<string[]> {
  const files: string[] = [];
  for (let page = 1; page <= MAX_PR_FILE_PAGES; page++) {
    const list = (await (await github(`${API}/pulls/${pr}/files?per_page=${PER_PAGE}&page=${page}`)).json()) as PrFile[];
    for (const f of list) {
      if (f.status !== "removed" && /^data\/xml\/[^/]+\.xml$/.test(f.filename)) files.push(f.filename);
    }
    if (list.length < PER_PAGE) break;
  }
  return files;
}

// Only ingestion pull requests add papers; correction commits rewrite existing files and are ignored.
// Pull requests are taken oldest first within the MAX_PRS / MAX_FILES budget (the first one always
// fits). When some are left over, `since` only moves to the last processed one and the etag is not
// stored, so the next run picks the rest up instead of getting a 304.
export async function fetchNew(cursor: AclCursor | Record<string, unknown> | null): Promise<{ papers: VenuePaper[]; cursor: AclCursor }> {
  const prev = (cursor ?? {}) as AclCursor;
  const since = prev.since ?? new Date(Date.now() - FIRST_RUN_DAYS * 86_400_000).toISOString();
  const commits: Commit[] = [];
  let etag: string | undefined;
  let complete = false;
  for (let page = 1; page <= MAX_COMMIT_PAGES; page++) {
    const params = new URLSearchParams({ path: "data/xml", since, per_page: String(PER_PAGE), page: String(page) });
    const conditional: Record<string, string> = page === 1 && prev.etag ? { "if-none-match": prev.etag } : {};
    const response = await github(`${API}/commits?${params}`, conditional);
    if (response.status === 304) return { papers: [], cursor: prev };
    if (page === 1) etag = response.headers.get("etag") ?? undefined;
    const list = (await response.json()) as Commit[];
    commits.push(...list);
    if (list.length < PER_PAGE) {
      complete = true;
      break;
    }
  }
  if (!complete) console.warn(`ACL: more than ${MAX_COMMIT_PAGES * PER_PAGE} commits since ${since}; older ones are not listed`);

  const seen = new Set(prev.seenPrs ?? []);
  const byPr = new Map<number, string>();
  for (const c of commits) {
    if (!/\bingest/i.test(c.commit.message)) continue;
    const pr = Number(c.commit.message.match(/\(#(\d+)\)/)?.[1]);
    if (!Number.isInteger(pr) || seen.has(pr)) continue;
    const date = c.commit.committer?.date ?? "";
    if (!byPr.has(pr) || date > byPr.get(pr)!) byPr.set(pr, date);
  }
  const pending = [...byPr].sort((a, b) => a[1].localeCompare(b[1]));

  const files = new Set<string>();
  const done: [number, string][] = [];
  for (const [pr, date] of pending) {
    if (done.length >= MAX_PRS) break;
    const list = await prFiles(pr);
    const added = list.filter((f) => !files.has(f));
    if (done.length > 0 && files.size + added.length > MAX_FILES) break;
    added.forEach((f) => files.add(f));
    done.push([pr, date]);
  }

  const minYear = new Date().getUTCFullYear() - 1;
  const papers: VenuePaper[] = [];
  for (const file of files) {
    const raw = await httpGet(`${RAW}${file}`, {}, 60_000);
    if (!raw.ok) throw new Error(`ACL XML ${file}: HTTP ${raw.status}`);
    papers.push(...parseAclXml(await raw.text(), minYear));
  }

  const caughtUp = done.length === pending.length;
  const newest = commits
    .map((c) => c.commit.committer?.date)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);
  const lastDone = done.at(-1)?.[1] || undefined;
  return {
    papers,
    cursor: {
      since: caughtUp ? (newest ?? since) : (lastDone ?? since),
      etag: caughtUp && complete ? (etag ?? prev.etag) : undefined,
      seenPrs: [...(prev.seenPrs ?? []), ...done.map(([pr]) => pr)].slice(-SEEN_PRS_KEPT),
    },
  };
}

const paramsSchema = z.object({
  repo: z.string().default("acl-org/acl-anthology"),
  path: z.string().default("data/xml"),
  branch: z.string().default("master"),
});

export const aclAdapter: SourceAdapter<z.infer<typeof paramsSchema>> = {
  kind: "acl",
  paramsSchema,
  testConnection: () =>
    timed(async () => {
      const response = await github(`${API}/commits?path=data/xml&per_page=1`, {}, TEST_TIMEOUT_MS);
      const [commit] = (await response.json()) as Commit[];
      return commit?.commit.message.split("\n")[0];
    }),
};
