import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { env } from "@/lib/env";
import { saveLeadFigures } from "./hf";
import { withArxivLease } from "./lease";
import { type SourceAdapter, TEST_TIMEOUT_MS, errorMessage, httpGet, stripTags, timed } from "./types";

export const MAX_CHARS = 20_000;
const LEASE_WAIT_MS = 15_000;
const CORE_SEARCH = "https://api.core.ac.uk/v3/search/works/";
const UNPAYWALL = "https://api.unpaywall.org/v2/";

export type FullTextSource = "arxiv-html" | "unpaywall" | "core";
export type FullText = { text: string; source: FullTextSource };
export type FullTextPaper = { arxivId?: string | null; doi?: string | null; title: string };
export type FullTextOptions = { coreApiKey?: string; unpaywallEmail?: string };
export type Figure = { url: string; caption: string };

export const MAX_FIGURES = 6;
const MAX_CAPTION = 160;
const ICON_CLASS = /\b(?:ds-[\w-]*|icon|logo|glyph)\b/i;
const FIGURE_TOKEN = /<figure\b[^>]*>|<\/figure\s*>|<img\b[^>]*>|<figcaption\b[^>]*>([\s\S]*?)<\/figcaption\s*>/gi;

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  const value = match?.[1] ?? match?.[2];
  return value ? value.replace(/&amp;/g, "&").trim() : null;
}

function caption(html: string): string {
  const text = stripTags(html.replace(/<(math|svg|script|style)\b[\s\S]*?<\/\1>/gi, " ")).replace(/\s+([:;,.])/g, "$1");
  return text.length <= MAX_CAPTION ? text : `${text.slice(0, MAX_CAPTION - 1).trimEnd()}…`;
}

// Raster images inside <figure> elements, in page order, each with the caption of the next
// <figcaption> (the enclosing figure's). Site icons, logos, SVGs and data URIs are skipped, URLs
// are made absolute against `baseUrl` (the page's final URL: arXiv's relative srcs start with
// "<id>v<n>/"), duplicates are dropped, and at most 6 are returned.
export function extractFigures(html: string, baseUrl: string): Figure[] {
  const out: Figure[] = [];
  const seen = new Set<string>();
  const pending: Figure[] = [];
  let depth = 0;
  for (const match of html.matchAll(FIGURE_TOKEN)) {
    const token = match[0];
    if (/^<figure\b/i.test(token)) depth++;
    else if (/^<\/figure/i.test(token)) {
      depth = Math.max(0, depth - 1);
      if (depth === 0) pending.length = 0;
    } else if (/^<figcaption/i.test(token)) {
      for (const figure of pending.splice(0)) figure.caption = caption(match[1] ?? "");
    } else if (depth > 0 && out.length < MAX_FIGURES) {
      const src = attr(token, "src");
      if (!src || src.startsWith("data:") || src.includes("/static/") || ICON_CLASS.test(attr(token, "class") ?? "")) continue;
      let url: URL;
      try {
        url = new URL(src, baseUrl);
      } catch {
        continue;
      }
      if (!/^https?:$/.test(url.protocol) || /\.svg$/i.test(url.pathname) || seen.has(url.href)) continue;
      seen.add(url.href);
      const figure = { url: url.href, caption: "" };
      out.push(figure);
      pending.push(figure);
    }
  }
  return out;
}

// Stores the figures (an empty list records the attempt) and offers the first as an arxiv_html lead figure.
export async function saveFigures(arxivId: string, figures: Figure[]): Promise<void> {
  await db.execute(sql`
    update research_signal.papers set figures = ${JSON.stringify(figures)}::jsonb where arxiv_id = ${arxivId}`);
  if (figures[0]) await saveLeadFigures([{ arxivId, url: figures[0].url, source: "arxiv_html" }]);
}

// Drops markup that carries no prose (head, scripts, MathML with its TeX annotations,
// navigation), then strips the remaining tags and keeps the first 20,000 characters.
export function htmlToText(html: string): string {
  const article = html.search(/<article\b/i);
  const body = (article >= 0 ? html.slice(article) : html)
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|math|svg|nav|header|footer|form|dialog|button|noscript)\b[\s\S]*?<\/\1>/gi, " ");
  return stripTags(body).slice(0, MAX_CHARS);
}

type HtmlPage = { html: string; url: string };

async function fetchPage(url: string, accept = "text/html"): Promise<HtmlPage | null> {
  const response = await httpGet(url, { accept }, 30_000);
  if (!response.ok) return null;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("html")) return null;
  return { html: await response.text(), url: response.url || url };
}

async function fetchHtml(url: string, accept = "text/html"): Promise<string | null> {
  return (await fetchPage(url, accept))?.html ?? null;
}

const arxivHtmlUrl = (arxivId: string) => `https://arxiv.org/html/${encodeURIComponent(arxivId)}`;

// One arXiv HTML request; the caller holds the arXiv lease and has already waited. Returns the
// page's figures, or an empty list when arXiv has no HTML version.
export async function fetchArxivFigures(arxivId: string): Promise<Figure[]> {
  const page = await fetchPage(arxivHtmlUrl(arxivId));
  return page ? extractFigures(page.html, page.url) : [];
}

async function fromArxiv(arxivId: string): Promise<string | null> {
  const result = await withArxivLease(
    "fulltext",
    async (wait) => {
      await wait();
      return fetchPage(arxivHtmlUrl(arxivId));
    },
    { maxWaitMs: LEASE_WAIT_MS },
  );
  if (result === "busy" || !result) return null;
  try {
    await saveFigures(arxivId, extractFigures(result.html, result.url));
  } catch (error) {
    console.warn(`figures for ${arxivId} not saved: ${errorMessage(error)}`);
  }
  return result.html;
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
