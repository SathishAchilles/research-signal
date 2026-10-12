import { sql } from "drizzle-orm";
import { connection, NextResponse } from "next/server";
import { db } from "@/db/client";
import { checkModels } from "@/lib/llm/models-check";
import { isSchedulerStale } from "@/lib/pipeline/jobs";
import { errorMessage } from "@/lib/sources/types";

const MODELS_TIMEOUT_MS = 8000;

type LatestRun = {
  source_kind: string;
  stage: string;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  items: number | null;
  error: string | null;
  in_progress: boolean;
};

async function modelsMissing(): Promise<{ missing: string[] | null; error?: string }> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("model check timed out")), MODELS_TIMEOUT_MS),
    );
    const { missing } = await Promise.race([checkModels(), timeout]);
    return { missing };
  } catch (error) {
    return { missing: null, error: errorMessage(error) };
  }
}

export async function GET() {
  await connection();
  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    return NextResponse.json({ db: "error", error: errorMessage(error) }, { status: 503 });
  }

  const [[size], runs, [lastCall], schedulerStale, models] = await Promise.all([
    db.execute<{ bytes: string | null }>(sql`
      select sum(pg_total_relation_size(format('%I.%I', schemaname, tablename)::regclass))::bigint as bytes
      from pg_tables where schemaname = 'research_signal'`),
    // Latest finished, non-smoke run per source; inProgress flags a newer run that has not finished yet.
    db.execute<LatestRun>(sql`
      select distinct on (r.source_kind) r.source_kind, r.stage, r.started_at, r.finished_at, r.status, r.items, r.error,
        exists (
          select 1 from research_signal.source_runs u
          where u.source_kind = r.source_kind and u.finished_at is null
            and u.stage not like 'smoke%' and u.started_at > r.started_at
        ) as in_progress
      from research_signal.source_runs r
      where r.source_kind is not null and r.finished_at is not null and r.stage not like 'smoke%'
      order by r.source_kind, r.started_at desc`),
    db.execute<{ status: string }>(sql`
      select status from research_signal.llm_calls order by created_at desc, id desc limit 1`),
    isSchedulerStale(),
    modelsMissing(),
  ]);

  return NextResponse.json({
    db: "ok",
    schemaBytes: Number(size?.bytes ?? 0),
    sourceRuns: Object.fromEntries(
      runs.map((r) => [
        r.source_kind,
        {
          stage: r.stage,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          status: r.status,
          items: r.items === null ? null : Number(r.items),
          error: r.error,
          inProgress: r.in_progress,
        },
      ]),
    ),
    schedulerStale,
    llmCreditsExhausted: lastCall?.status === "credits_exhausted",
    modelsMissing: models.missing,
    missing: models.missing,
    ...(models.error ? { modelsError: models.error } : {}),
  });
}
