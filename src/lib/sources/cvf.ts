import { z } from "zod";
import { type SourceAdapter, TEST_TIMEOUT_MS, decodeEntities, httpGet, stripTags, timed } from "./types";
import type { VenuePaper } from "./venues";

const BASE = "https://openaccess.thecvf.com/";
const MENU_URL = `${BASE}menu`;
const MAX_NEW_KEYS = 5;

export type CvfCursor = { seen?: string[] };

// Conference keys look like CVPR2026, WACV2026 or CVPR2026_findings; workshop menus and
// the legacy *.py pages are not paper lists.
export function parseMenu(html: string): string[] {
  const keys = new Set<string>();
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (/^[A-Z]+\d{4}(?:_[a-z]+)?$/.test(href) && !href.endsWith("_workshops")) keys.add(href);
  }
  return [...keys];
}

function venueName(key: string): { name: string; year: number } {
  const match = key.match(/^([A-Z]+)(\d{4})(?:_([a-z]+))?$/);
  if (!match) return { name: key, year: new Date().getUTCFullYear() };
  const [, conf, year, suffix] = match;
  const label = suffix ? ` ${suffix[0].toUpperCase()}${suffix.slice(1)}` : "";
  return { name: `${conf} ${year}${label}`, year: Number(year) };
}

export function parseConference(key: string, html: string): VenuePaper[] {
  const { name, year } = venueName(key);
  const chunks = html.split(/<dt class="ptitle">/).slice(1);
  const out: VenuePaper[] = [];
  for (const chunk of chunks) {
    const link = chunk.match(/<a href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!link) continue;
    const title = stripTags(link[2]);
    if (!title) continue;
    const pdf = chunk.match(/href="([^"]*\/papers\/[^"]+\.pdf)"/)?.[1];
    const authors = [...chunk.matchAll(/name="query_author" value="([^"]*)"/g)].map((m) =>
      decodeEntities(m[1]).trim(),
    );
    out.push({
      source: "cvf",
      venue: name,
      title,
      abstract: "",
      authors: authors.filter(Boolean),
      url: new URL(link[1], BASE).href,
      pdfUrl: pdf ? new URL(pdf, BASE).href : null,
      doi: null,
      publishedAt: new Date(Date.UTC(year, 0, 1)),
    });
  }
  return out;
}

async function getText(url: string, timeoutMs = 60_000): Promise<string> {
  const response = await httpGet(url, {}, timeoutMs);
  if (!response.ok) throw new Error(`CVF ${url}: HTTP ${response.status}`);
  return response.text();
}

export async function fetchConference(key: string): Promise<VenuePaper[]> {
  return parseConference(key, await getText(`${BASE}${encodeURIComponent(key)}?day=all`));
}

// The first run records the conferences already listed as seen, without fetching them.
export async function fetchNew(cursor: CvfCursor | Record<string, unknown> | null): Promise<{ papers: VenuePaper[]; cursor: CvfCursor }> {
  const keys = parseMenu(await getText(MENU_URL, 30_000));
  if (keys.length === 0) throw new Error("CVF menu has no conference keys");
  const prevSeen = (cursor as CvfCursor | null)?.seen;
  if (!prevSeen) return { papers: [], cursor: { seen: keys } };

  const seen = new Set(prevSeen);
  const fresh = keys.filter((k) => !seen.has(k)).slice(0, MAX_NEW_KEYS);
  const papers: VenuePaper[] = [];
  for (const key of fresh) {
    papers.push(...(await fetchConference(key)));
    seen.add(key);
  }
  return { papers, cursor: { seen: [...seen] } };
}

const paramsSchema = z.object({ menuUrl: z.url().default(MENU_URL) });

export const cvfAdapter: SourceAdapter<z.infer<typeof paramsSchema>> = {
  kind: "cvf",
  paramsSchema,
  testConnection: () =>
    timed(async () => {
      const keys = parseMenu(await getText(MENU_URL, TEST_TIMEOUT_MS));
      if (keys.length === 0) throw new Error("menu has no conference keys");
      return `${venueName(keys[0]).name} (${keys.length} conferences listed)`;
    }),
};
