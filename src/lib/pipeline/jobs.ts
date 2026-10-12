import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { jobStage, jobs, sourceRuns } from "@/db/schema";

export type JobStage = (typeof jobStage.enumValues)[number];
export type Job = typeof jobs.$inferSelect;

export const MAX_ATTEMPTS = 3;
export const SCHEDULER_STALE_HOURS = 26;

// One PENDING job per stage (partial unique index, scripts/sql/006_jobs_dedupe.sql): a repeated enqueue
// returns the waiting job instead of inserting, atomically. Dedupe is on stage only, so a payload difference
// (including the lastError that fail() appends) never creates a second waiting job.
export async function enqueue(
  stage: JobStage,
  payload: Record<string, unknown> = {},
  runAfter?: Date,
): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db
      .insert(jobs)
      .values({ stage, payload, ...(runAfter ? { runAfter } : {}) })
      .onConflictDoNothing({ target: jobs.stage, where: sql`status = 'PENDING'` })
      .returning({ id: jobs.id });
    if (row) return row.id;
    const [waiting] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.stage, stage), eq(jobs.status, "PENDING")))
      .limit(1);
    // The waiting job may have been claimed between the two statements; then insert again.
    if (waiting) return waiting.id;
  }
  throw new Error(`enqueue(${stage}) kept conflicting with a concurrently claimed job`);
}

// `stages` limits the claim to stages the caller can run; the others stay PENDING.
export async function claimNext(stages?: JobStage[]): Promise<Job | null> {
  if (stages && stages.length === 0) return null;
  const next = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "PENDING"),
        lte(jobs.runAfter, sql`now()`),
        stages ? inArray(jobs.stage, stages) : undefined,
      ),
    )
    .orderBy(jobs.runAfter)
    .limit(1)
    .for("update", { skipLocked: true });
  const [job] = await db
    .update(jobs)
    .set({
      status: "RUNNING",
      lockedUntil: sql`now() + interval '5 min'`,
      attempts: sql`${jobs.attempts} + 1`,
    })
    .where(eq(jobs.id, sql`(${next})`))
    .returning();
  return job ?? null;
}

// locked_until doubles as the finish time of a DONE job (the table has no finished_at).
export async function complete(id: number): Promise<void> {
  await db.update(jobs).set({ status: "DONE", lockedUntil: sql`now()` }).where(eq(jobs.id, id));
}

// A retry needs the stage's single PENDING slot; when a newer job already waits there, it supersedes the retry.
const noOtherPending = sql`not exists (
  select 1 from research_signal.jobs other
  where other.stage = ${jobs.stage} and other.status = 'PENDING' and other.id <> ${jobs.id})`;

const PENDING_INDEX = "jobs_one_pending_per_stage_idx";

type PgError = { code?: unknown; constraint_name?: unknown; cause?: unknown };
const pgFields = (e: unknown): PgError => (typeof e === "object" && e !== null ? (e as PgError) : {});

// drizzle wraps the driver error, so the Postgres fields sit on `cause`.
function isPendingSlotTaken(error: unknown): boolean {
  const outer = pgFields(error);
  const pg = outer.code ? outer : pgFields(outer.cause);
  return pg.code === "23505" && pg.constraint_name === PENDING_INDEX;
}

// noOtherPending cannot see a PENDING row that another transaction has not committed yet, so two
// concurrent re-queues of one stage can both pick PENDING; the second then hits the unique index.
// Running the update again sees the committed row and routes the job to FAILED (superseded).
async function retryOnPendingConflict<T>(update: () => Promise<T>): Promise<T> {
  try {
    return await update();
  } catch (error) {
    if (!isPendingSlotTaken(error)) throw error;
    return update();
  }
}

export async function fail(id: number, err: unknown): Promise<"PENDING" | "FAILED"> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
  const retry = sql`${jobs.attempts} < ${MAX_ATTEMPTS} and ${noOtherPending}`;
  const [row] = await retryOnPendingConflict(() => db
    .update(jobs)
    .set({
      status: sql`case when ${retry} then 'PENDING' else 'FAILED' end::research_signal.job_status`,
      runAfter: sql`case when ${retry} then now() + interval '5 min' else ${jobs.runAfter} end`,
      lockedUntil: null,
      payload: sql`${jobs.payload} || jsonb_build_object('lastError', ${message}::text)`,
    })
    .where(eq(jobs.id, id))
    .returning({ status: jobs.status }));
  return row?.status === "PENDING" ? "PENDING" : "FAILED";
}

// Jobs whose runner died (lock expired while RUNNING) go back to the queue, or fail after the last attempt.
// Only the oldest expired job per stage may take the stage's PENDING slot; the others fail as superseded.
export async function requeueExpired(): Promise<number> {
  const firstExpired = sql`${jobs.id} in (
    select distinct on (stage) id from research_signal.jobs
    where status = 'RUNNING' and locked_until <= now()
    order by stage, id)`;
  const rows = await retryOnPendingConflict(() => db
    .update(jobs)
    .set({
      status: sql`case when ${jobs.attempts} < ${MAX_ATTEMPTS} and ${noOtherPending} and ${firstExpired}
        then 'PENDING' else 'FAILED' end::research_signal.job_status`,
      lockedUntil: null,
    })
    .where(and(eq(jobs.status, "RUNNING"), lte(jobs.lockedUntil, sql`now()`)))
    .returning({ id: jobs.id }));
  return rows.length;
}

export async function lastJobDoneAt(): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<string | null>`max(${jobs.lockedUntil})` })
    .from(jobs)
    .where(eq(jobs.status, "DONE"));
  return row?.at ? new Date(row.at) : null;
}

// Stages the scheduler (cron) runs directly; each records a source_runs row without going through the jobs table.
const SCHEDULED_STAGES = ["ingest", "drain", "hf_refresh", "weekly"];

// One query (not two in parallel): /api/health already runs several queries at once against a pool of 5.
export async function lastSchedulerActivityAt(): Promise<Date | null> {
  const [row] = await db.execute<{ at: string | null }>(sql`
    select greatest(
      (select max(${jobs.lockedUntil}) from ${jobs} where ${jobs.status} = 'DONE'),
      (select max(${sourceRuns.finishedAt}) from ${sourceRuns}
        where ${sourceRuns.stage} in ${SCHEDULED_STAGES} and ${sourceRuns.finishedAt} is not null)
    ) as at`);
  return row?.at ? new Date(row.at) : null;
}

// Stale only when neither a queued job nor a scheduled stage has finished within SCHEDULER_STALE_HOURS.
export async function isSchedulerStale(now = new Date()): Promise<boolean> {
  const at = await lastSchedulerActivityAt();
  return !at || now.getTime() - at.getTime() > SCHEDULER_STALE_HOURS * 3_600_000;
}
