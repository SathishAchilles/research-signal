import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { type Job, claimNext, enqueue, fail } from "@/lib/pipeline/jobs";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Uses the weekly stage, which nothing drains during a smoke run; the rows are deleted afterwards.
// Dedupe is on stage only, so enqueue would hand back a real waiting weekly job: the smoke refuses to
// start while one exists and only ever touches rows carrying its own tag.
export default async function run() {
  const tag = randomUUID();
  const mine = sql`${jobs.payload}->>'smoke' = ${tag}`;
  const foreign: Job[] = [];
  const past = () => new Date(Date.now() - 60_000);
  const check = (ok: boolean, message: string) => {
    if (!ok) throw new Error(message);
  };
  const ownId = async (id: number) => {
    const [row] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, id), mine));
    check(Boolean(row), `enqueue returned job ${id}, which is not this smoke's; stopping`);
    return id;
  };
  const claimWeekly = async () => {
    const job = await claimNext(["weekly"]);
    if (job && job.payload.smoke !== tag) foreign.push(job);
    return job;
  };

  try {
    const [waiting] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.stage, "weekly"), eq(jobs.status, "PENDING")));
    check(!waiting, `a real weekly job (${waiting?.id}) is waiting; the smoke would adopt it, so it stops`);

    // 1. Repeated enqueues of a stage return the one waiting job, whatever the payload.
    const first = await ownId(await enqueue("weekly", { smoke: tag, n: 1 }, past()));
    const second = await enqueue("weekly", { smoke: tag, n: 2 }, past());
    const third = await enqueue("weekly", { smoke: tag, n: 1 });
    console.log(`enqueue x3 (payloads n=1, n=2, n=1): ${first}, ${second}, ${third}`);
    check(second === first && third === first, "enqueue must reuse the stage's waiting job");

    // 2. Two concurrent claims get the one job exactly once.
    const claimed = await Promise.all([claimWeekly(), claimWeekly()]);
    console.log(`concurrent claims: ${claimed.map((j) => (j ? `${j.id} (${j.status}, attempts ${j.attempts})` : "null")).join(", ")}`);
    const got = claimed.filter((j): j is Job => j !== null);
    check(got.length === 1 && got[0].id === first, "exactly one of two concurrent claims must get the job");

    // 3. With the first job RUNNING the slot is free again; a failed job is superseded by the new waiting one.
    const next = await ownId(await enqueue("weekly", { smoke: tag, n: 3 }, past()));
    check(next !== first, "a new job must be inserted while the first one runs");
    const superseded = await fail(first, new Error("smoke failure"));
    console.log(`job ${next} waiting; fail(${first}) -> ${superseded}`);
    check(superseded === "FAILED", "fail() must not re-queue while another job of the stage waits");

    // 4. Without a waiting job, fail() re-queues while attempts < 3.
    check((await claimWeekly())?.id === next, `claim must return job ${next}`);
    const requeued = await fail(next, new Error("smoke failure"));
    console.log(`fail(${next}) with no other waiting job -> ${requeued}`);
    check(requeued === "PENDING", "fail() should re-queue while attempts < 3");
    await db.update(jobs).set({ runAfter: past() }).where(eq(jobs.id, next));

    // 5. A waiting job committed while fail() runs: fail()'s NOT EXISTS cannot see it, so its PENDING
    //    write blocks on the unique index and gets unique_violation once the other insert commits.
    //    The guard re-runs the update, which now sees the waiting job and returns FAILED.
    check((await claimWeekly())?.id === next, `second claim must return job ${next}`);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let announce!: (id: number) => void;
    const inserted = new Promise<number>((resolve) => (announce = resolve));
    const blocker = db.transaction(async (tx) => {
      const [row] = await tx.insert(jobs).values({ stage: "weekly", payload: { smoke: tag, n: 4 } }).returning({ id: jobs.id });
      announce(row.id);
      await gate;
    });
    const blockerId = await Promise.race([
      inserted,
      blocker.then(() => {
        throw new Error("blocking transaction ended before inserting");
      }),
    ]);
    const racing = fail(next, new Error("smoke conflict")).then((status) => ({ status, at: Date.now() }));
    await sleep(1500);
    const releasedAt = Date.now();
    release();
    await blocker;
    const raced = await racing;
    console.log(`fail(${next}) racing uncommitted job ${blockerId} -> ${raced.status}, ${raced.at - releasedAt} ms after the commit`);
    check(raced.at >= releasedAt, "fail() finished before the commit, so it never waited on the unique index");
    check(raced.status === "FAILED", "fail() must fall back to FAILED when the stage's slot was taken concurrently");

    const rows = await db
      .select({ id: jobs.id, status: jobs.status, attempts: jobs.attempts, lastError: sql<string>`${jobs.payload}->>'lastError'` })
      .from(jobs)
      .where(mine)
      .orderBy(jobs.id);
    for (const r of rows) console.log(`job ${r.id}: ${r.status} attempts=${r.attempts}${r.lastError ? ` lastError="${r.lastError}"` : ""}`);
    check(rows.filter((r) => r.status === "PENDING").length === 1, "exactly one smoke job must be left waiting");
  } finally {
    // Any real job claimed by accident goes back to the queue untouched.
    for (const job of foreign) {
      await db
        .update(jobs)
        .set({ status: "PENDING", lockedUntil: null, attempts: job.attempts - 1 })
        .where(inArray(jobs.id, [job.id]));
    }
    await db.delete(jobs).where(mine);
    await db.$client.end();
  }
}
