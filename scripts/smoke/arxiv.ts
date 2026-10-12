import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sourceRuns } from "@/db/schema";
import { DEFAULT_CATEGORIES, fetchBackstop, fetchRssDelta, upsertArxivItems } from "@/lib/sources/arxiv";
import { withArxivLease } from "@/lib/sources/lease";
import { getEnabledSources } from "@/lib/sources/registry";
import { finishRun, startRun } from "@/lib/sources/runs";
import { errorMessage } from "@/lib/sources/types";

export default async function run() {
  const runId = await startRun("arxiv", "smoke_arxiv");
  try {
    const [source] = (await getEnabledSources("discover")).filter((s) => s.kind === "arxiv");
    const params = source?.params as { categories?: string[]; backstopDays?: number } | undefined;
    const categories = params?.categories ?? DEFAULT_CATEGORIES;
    const days = params?.backstopDays ?? 4;
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86_400_000);

    const result = await withArxivLease("smoke-arxiv", async (wait) => {
      const rss = await fetchRssDelta(categories, undefined, wait);
      const backstop = await fetchBackstop(categories, from, to, wait);
      return { rss, backstop };
    });
    if (result === "busy") throw new Error("arXiv lease is busy");

    const { rss, backstop } = result;
    console.log(`categories: ${categories.join(", ")}`);
    console.log(`rss items (new + cross): ${rss.items.length}, etag ${rss.etag ? "present" : "absent"}`);
    console.log(`backstop items (${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)}): ${backstop.length}`);
    const inserted = await upsertArxivItems([...rss.items, ...backstop]);
    console.log(`upserted: ${new Set([...rss.items, ...backstop].map((i) => i.arxivId)).size} unique, ${inserted} newly inserted`);

    await finishRun(runId, "OK", inserted);
    const [row] = await db.select().from(sourceRuns).where(eq(sourceRuns.id, runId));
    console.log(`source_runs: ${row.sourceKind}/${row.stage} status=${row.status} items=${row.items}`);
  } catch (error) {
    await finishRun(runId, "FAILED", 0, errorMessage(error));
    throw error;
  } finally {
    await db.$client.end();
  }
}
