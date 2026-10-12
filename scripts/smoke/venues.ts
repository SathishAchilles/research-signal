import { db } from "@/db/client";
import { fetchConference, parseMenu } from "@/lib/sources/cvf";
import { fetchVolume, parseFeed } from "@/lib/sources/pmlr";
import { httpGet } from "@/lib/sources/types";
import { syncVenues } from "@/lib/sources/venues";

function describe(cursor: Record<string, unknown> | null): string {
  if (!cursor) return "none";
  return Object.entries(cursor)
    .map(([k, v]) => (Array.isArray(v) ? `${k}=[${v.length}]` : `${k}=${k === "etag" ? "present" : String(v)}`))
    .join(" ");
}

// With --parse, also parses the newest CVF conference and PMLR volume without storing them.
export default async function run(args: string[]) {
  try {
    for (const r of await syncVenues("smoke_venues")) {
      console.log(
        `${r.kind}: ${r.status} fetched=${r.fetched} inserted=${r.inserted} linked=${r.linked} skipped=${r.skipped} cursor: ${describe(r.cursor)}${r.error ? ` error: ${r.error}` : ""}`,
      );
    }

    if (args.includes("--parse")) {
      const menu = await (await httpGet("https://openaccess.thecvf.com/menu")).text();
      const key = parseMenu(menu).find((k) => !k.includes("_"));
      if (key) {
        const papers = await fetchConference(key);
        console.log(`parse cvf ${key}: ${papers.length} papers, first: "${papers[0]?.title}" pdf=${Boolean(papers[0]?.pdfUrl)}`);
      }
      const feed = parseFeed(await (await httpGet("https://proceedings.mlr.press/feed.xml")).text());
      const volume = feed.find((v) => v.id === "v300") ?? feed.at(-1);
      if (volume) {
        const papers = await fetchVolume(volume);
        console.log(`parse pmlr ${volume.id}: ${papers.length} papers, first: "${papers[0]?.title}" authors=${papers[0]?.authors.length}`);
      }
    }
  } finally {
    await db.$client.end();
  }
}
