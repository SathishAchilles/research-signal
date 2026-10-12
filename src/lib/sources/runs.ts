import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sourceRuns, sources } from "@/db/schema";
import type { SourceKind } from "./types";

export type RunStatus = "OK" | "PARTIAL" | "FAILED" | "SKIPPED";

export async function startRun(kind: SourceKind | null, stage: string): Promise<string> {
  const [row] = await db
    .insert(sourceRuns)
    .values({ sourceKind: kind, stage })
    .returning({ id: sourceRuns.id });
  if (kind) {
    await db.update(sources).set({ lastRunAt: sql`now()` }).where(eq(sources.kind, kind));
  }
  return row.id;
}

export async function finishRun(
  id: string,
  status: RunStatus,
  items: number,
  error?: string,
): Promise<void> {
  const [run] = await db
    .update(sourceRuns)
    .set({ finishedAt: sql`now()`, status, items, error: error ?? null })
    .where(eq(sourceRuns.id, id))
    .returning({ kind: sourceRuns.sourceKind });
  if (!run?.kind) return;
  await db
    .update(sources)
    .set({
      lastRunAt: sql`now()`,
      lastStatus: status,
      lastError: error ?? null,
      lastItemCount: items,
    })
    .where(eq(sources.kind, run.kind as SourceKind));
}
