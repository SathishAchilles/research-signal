import { db } from "@/db/client";
import { batchLookup } from "@/lib/sources/s2";
import { SourceUnavailable } from "@/lib/sources/types";

export default async function run(args: string[]) {
  try {
    const ids = args.length ? args : ["1706.03762"];
    try {
      const papers = await batchLookup(ids);
      for (const p of papers) {
        console.log(`${p.arxivId}: "${p.title}" citationCount=${p.citationCount} venue=${p.venue}`);
        p.buildsOn.forEach((r, i) => console.log(`  builds_on ${i + 1}: "${r.title}" (${r.citationCount})`));
      }
      console.log(`found ${papers.length} of ${ids.length}`);
    } catch (error) {
      if (!(error instanceof SourceUnavailable)) throw error;
      console.log(`SourceUnavailable: ${error.message}`);
    }
  } finally {
    await db.$client.end();
  }
}
