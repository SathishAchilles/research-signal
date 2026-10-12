import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { type SourceAdapter, TEST_TIMEOUT_MS, decodeEntities, httpGet, stripTags, timed } from "./types";
import type { VenuePaper } from "./venues";

const BASE = "https://proceedings.mlr.press/";
const FEED_URL = `${BASE}feed.xml`;
const MAX_NEW_VOLUMES = 5;

export type PmlrCursor = { seen?: string[]; etag?: string };
type Volume = { id: string; description: string };

const parser = new XMLParser({ parseTagValue: false, isArray: (name) => name === "item" });

export function parseFeed(xml: string): Volume[] {
  const items = (parser.parse(xml)?.rss?.channel?.item ?? []) as { title?: string; description?: string }[];
  return items
    .map((item) => ({ id: String(item.title ?? "").trim(), description: stripTags(String(item.description ?? "")) }))
    .filter((v) => /^v\d+$/.test(v.id));
}

export function parseVolume(volume: Volume, html: string): VenuePaper[] {
  const year = Number(volume.description.match(/\b(?:19|20)\d{2}\b/)?.[0]) || new Date().getUTCFullYear();
  const out: VenuePaper[] = [];
  for (const chunk of html.split(/<div class="paper">/).slice(1)) {
    const title = stripTags(chunk.match(/<p class="title">([\s\S]*?)<\/p>/)?.[1] ?? "");
    const abs = chunk.match(/href="([^"]+\.html)"[^>]*>abs</)?.[1];
    if (!title || !abs) continue;
    const authors = decodeEntities(chunk.match(/<span class="authors">([\s\S]*?)<\/span>/)?.[1] ?? "")
      .split(",")
      .map((a) => a.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    out.push({
      source: "pmlr",
      venue: `PMLR ${volume.id}: ${volume.description}`,
      title,
      abstract: "",
      authors,
      url: new URL(abs, BASE).href,
      pdfUrl: chunk.match(/href="([^"]+\.pdf)"/)?.[1] ?? null,
      doi: null,
      publishedAt: new Date(Date.UTC(year, 0, 1)),
    });
  }
  return out;
}

export async function fetchVolume(volume: Volume): Promise<VenuePaper[]> {
  const response = await httpGet(`${BASE}${volume.id}/`, {}, 60_000);
  if (!response.ok) throw new Error(`PMLR ${volume.id}: HTTP ${response.status}`);
  return parseVolume(volume, await response.text());
}

// Volume numbers are not published in order, so the cursor keeps the set of volumes seen.
// The first run records the volumes already listed as seen, without fetching them.
export async function fetchNew(cursor: PmlrCursor | Record<string, unknown> | null): Promise<{ papers: VenuePaper[]; cursor: PmlrCursor }> {
  const prev = (cursor ?? {}) as PmlrCursor;
  const response = await httpGet(FEED_URL, prev.etag && prev.seen ? { "if-none-match": prev.etag } : {});
  if (response.status === 304) return { papers: [], cursor: prev };
  if (!response.ok) throw new Error(`PMLR feed failed: HTTP ${response.status}`);
  const volumes = parseFeed(await response.text());
  if (volumes.length === 0) throw new Error("PMLR feed has no volumes");
  const etag = response.headers.get("etag") ?? undefined;
  if (!prev.seen) return { papers: [], cursor: { seen: volumes.map((v) => v.id), etag } };

  const seen = new Set(prev.seen);
  const fresh = volumes.filter((v) => !seen.has(v.id)).slice(0, MAX_NEW_VOLUMES);
  const papers: VenuePaper[] = [];
  for (const volume of fresh) {
    papers.push(...(await fetchVolume(volume)));
    seen.add(volume.id);
  }
  const done = fresh.length === volumes.filter((v) => !prev.seen!.includes(v.id)).length;
  return { papers, cursor: { seen: [...seen], etag: done ? etag : undefined } };
}

const paramsSchema = z.object({ feedUrl: z.url().default(FEED_URL) });

export const pmlrAdapter: SourceAdapter<z.infer<typeof paramsSchema>> = {
  kind: "pmlr",
  paramsSchema,
  testConnection: () =>
    timed(async () => {
      const response = await httpGet(FEED_URL, {}, TEST_TIMEOUT_MS);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const volumes = parseFeed(await response.text());
      const last = volumes.at(-1);
      if (!last) throw new Error("feed has no volumes");
      return `${last.id}: ${last.description}`;
    }),
};
