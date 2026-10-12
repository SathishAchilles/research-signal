import { z } from "zod";
import { env } from "@/lib/env";
import { withArxivLease } from "./lease";
import { type SourceAdapter, TEST_TIMEOUT_MS, httpGet, stripTags, timed } from "./types";

export const MAX_CHARS = 20_000;
const LEASE_WAIT_MS = 15_000;
const CORE_SEARCH = "https://api.core.ac.uk/v3/search/works/";
const UNPAYWALL = "https://api.unpaywall.org/v2/";

export type FullTextSource = "arxiv-html" | "unpaywall" | "core";
export type FullText = { text: string; source: FullTextSource };
export type FullTextPaper = { arxivId?: string | null; doi?: string | null; title: string };
export type FullTextOptions = { coreApiKey?: string; unpaywallEmail?: string };

// Drops markup that carries no prose (head, scripts, MathML with its TeX annotations,
// navigation), then strips the remaining tags and keeps the first 20,000 characters.
export function htmlToText(html: string): string {
  const article = html.search(/<article\b/i);
  const body = (article >= 0 ? html.slice(article) : html)
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|math|svg|nav|header|footer|form|dialog|button|noscript)\b[\s\S]*?<\/\1>/gi, " ");
  return stripTags(body).slice(0, MAX_CHARS);
}

async function fetchHtml(url: string, accept = "text/html"): Promise<string | null> {
  const response = await httpGet(url, { accept }, 30_000);
  if (!response.ok) return null;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("html")) return null;
  return response.text();
}

async function fromArxiv(arxivId: string): Promise<string | null> {
  const result = await withArxivLease(
    "fulltext",
    async (wait) => {
      await wait();
      return fetchHtml(`https://arxiv.org/html/${encodeURIComponent(arxivId)}`);
    },
    { maxWaitMs: LEASE_WAIT_MS },
  );
  return result === "busy" || !result ? null : result;
}

async function fromUnpaywall(doi: string, email: string): Promise<string | null> {
  const response = await httpGet(`${UNPAYWALL}${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`, {}, 15_000);
  if (!response.ok) return null;
  const body = (await response.json()) as { best_oa_location?: { url_for_landing_page?: string | null } | null };
  const landing = body.best_oa_location?.url_for_landing_page;
  return landing ? fetchHtml(landing) : null;
}

async function fromCore(title: string, apiKey: string): Promise<string | null> {
  const params = new URLSearchParams({ q: `title:"${title.replace(/"/g, "")}"`, limit: "1" });
  const response = await httpGet(`${CORE_SEARCH}?${params}`, { authorization: `Bearer ${apiKey}` }, 30_000);
  if (!response.ok) return null;
  const body = (await response.json()) as { results?: { fullText?: string | null }[] };
  return body.results?.[0]?.fullText ?? null;
}

function finish(raw: string | null, source: FullTextSource, isHtml: boolean): FullText | null {
  if (!raw) return null;
  const text = isHtml ? htmlToText(raw) : raw.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  return text ? { text, source } : null;
}

// Tries arXiv HTML, then Unpaywall for DOIs, then CORE when a key is given. PDFs are never fetched.
export async function getFullText(paper: FullTextPaper, options: FullTextOptions = {}): Promise<FullText | null> {
  const attempts: [FullTextSource, boolean, () => Promise<string | null>][] = [];
  if (paper.arxivId) attempts.push(["arxiv-html", true, () => fromArxiv(paper.arxivId!)]);
  if (paper.doi) {
    attempts.push(["unpaywall", true, () => fromUnpaywall(paper.doi!, options.unpaywallEmail ?? env.CONTACT_EMAIL)]);
  }
  if (options.coreApiKey && paper.title) {
    attempts.push(["core", false, () => fromCore(paper.title, options.coreApiKey!)]);
  }

  for (const [source, isHtml, attempt] of attempts) {
    try {
      const result = finish(await attempt(), source, isHtml);
      if (result) return result;
    } catch (error) {
      console.warn(`full text via ${source} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return null;
}

const unpaywallParams = z.object({
  email: z.email().default(env.CONTACT_EMAIL),
  htmlMaxChars: z.number().int().positive().default(MAX_CHARS),
});

export const unpaywallAdapter: SourceAdapter<z.infer<typeof unpaywallParams>> = {
  kind: "unpaywall",
  paramsSchema: unpaywallParams,
  testConnection: (params) =>
    timed(async () => {
      const doi = "10.18653/v1/2023.acl-long.1";
      const response = await httpGet(
        `${UNPAYWALL}${encodeURIComponent(doi)}?email=${encodeURIComponent(params.email)}`,
        {},
        TEST_TIMEOUT_MS,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return ((await response.json()) as { title?: string }).title;
    }),
};

const coreParams = z.object({});

export const coreAdapter: SourceAdapter<z.infer<typeof coreParams>> = {
  kind: "core",
  paramsSchema: coreParams,
  testConnection: (_params, secret) =>
    timed(async () => {
      if (!secret) throw new Error("no CORE API key configured");
      const params = new URLSearchParams({ q: "large language models", limit: "1" });
      const response = await httpGet(`${CORE_SEARCH}?${params}`, { authorization: `Bearer ${secret}` }, TEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return ((await response.json()) as { results?: { title?: string }[] }).results?.[0]?.title;
    }),
};
