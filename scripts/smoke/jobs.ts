import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { type Job, claimNext, complete, enqueue, fail } from "@/lib/pipeline/jobs";

// Uses the weekly stage, which nothing drains during a smoke run; the rows are deleted afterwards.
export default async function run() {
  const tag = randomUUID();
  const ids: number[] = [];
  const foreign: Job[] = [];
  try {
    ids.push(await enqueue("weekly", { smoke: tag, n: 1 }, new Date(Date.now() - 60_000)));
    ids.push(await enqueue("weekly", { smoke: tag, n: 2 }, new Date(Date.now() - 60_000)));
    const again = await enqueue("weekly", { smoke: tag, n: 1 });
    console.log(`enqueued: ${ids.join(", ")} (re-enqueue of the first returned ${again})`);
    if (again !== ids[0]) throw new Error("enqueue did not reuse the waiting job");

    const claimed = await Promise.all([claimNext(["weekly"]), claimNext(["weekly"])]);
    for (const job of claimed) if (job && !ids.includes(job.id)) foreign.push(job);
    console.log(`concurrent claims: ${claimed.map((j) => (j ? `${j.id} (${j.status}, attempts ${j.attempts})` : "null")).join(", ")}`);
    const [a, b] = claimed;
    if (!a || !b || a.id === b.id) throw new Error("two concurrent claimNext calls must get different jobs");

    await complete(ids[0]);
    const after = await fail(ids[1], new Error("smoke failure"));
    const rows = await db
      .select({ id: jobs.id, status: jobs.status, attempts: jobs.attempts, lastError: sql<string>`${jobs.payload}->>'lastError'` })
      .from(jobs)
      .where(inArray(jobs.id, ids));
    for (const r of rows) console.log(`job ${r.id}: ${r.status} attempts=${r.attempts}${r.lastError ? ` lastError="${r.lastError}"` : ""}`);
    if (after !== "PENDING") throw new Error("fail() should re-queue while attempts < 3");
  } finally {
    // Any real job claimed by accident goes back to the queue untouched.
    for (const job of foreign) {
      await db
        .update(jobs)
        .set({ status: "PENDING", lockedUntil: null, attempts: job.attempts - 1 })
        .where(inArray(jobs.id, [job.id]));
    }
    if (ids.length) await db.delete(jobs).where(inArray(jobs.id, ids));
    await db.$client.end();
  }
}
