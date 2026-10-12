import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { authAttempts } from "@/db/schema";

export const MAX_FAILURES = 5;

export async function isLocked(ip: string): Promise<boolean> {
  const rows = await db
    .select({ ip: authAttempts.ip })
    .from(authAttempts)
    .where(and(eq(authAttempts.ip, ip), gt(authAttempts.lockedUntil, sql`now()`)))
    .limit(1);
  return rows.length > 0;
}

// One atomic upsert: the fifth failure locks the address for 15 min * 2^lockouts (max 24 h)
// and starts a new count. The exponent is clamped so the interval cannot overflow.
export async function recordFailure(ip: string): Promise<void> {
  const reachesLimit = sql`${authAttempts.failures} + 1 >= ${MAX_FAILURES}`;
  await db
    .insert(authAttempts)
    .values({ ip, failures: 1 })
    .onConflictDoUpdate({
      target: authAttempts.ip,
      set: {
        failures: sql`case when ${reachesLimit} then 0 else ${authAttempts.failures} + 1 end`,
        lockouts: sql`case when ${reachesLimit} then ${authAttempts.lockouts} + 1 else ${authAttempts.lockouts} end`,
        lockedUntil: sql`case when ${reachesLimit}
          then now() + least(interval '15 minutes' * power(2, least(${authAttempts.lockouts}, 7)), interval '24 hours')
          else ${authAttempts.lockedUntil} end`,
        updatedAt: sql`now()`,
      },
    });
}

export async function clearAttempts(ip: string): Promise<void> {
  await db.delete(authAttempts).where(eq(authAttempts.ip, ip));
}
