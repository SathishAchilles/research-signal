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

// Reserves one guess for this key before the PIN is verified, in one atomic upsert. The row lock taken by
// ON CONFLICT serializes a parallel burst, so at most MAX_FAILURES reservations succeed per lockout window.
// The reservation that reaches the limit locks the key for 15 min * 2^lockouts (max 24 h) and starts a new
// count; the exponent is clamped so the interval cannot overflow. A locked key matches no row (the WHERE
// on DO UPDATE fails), so nothing is returned and the guess is refused. A correct PIN clears the row.
export async function reserveAttempt(ip: string): Promise<boolean> {
  const reachesLimit = sql`${authAttempts.failures} + 1 >= ${MAX_FAILURES}`;
  const rows = await db
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
      setWhere: sql`${authAttempts.lockedUntil} is null or ${authAttempts.lockedUntil} <= now()`,
    })
    .returning({ ip: authAttempts.ip });
  return rows.length > 0;
}

// Runs one PIN check under the per-key budget: the guess is reserved first, so it counts even if the
// request dies mid-verify, and only a successful check clears the count.
export async function guardedCheck(ip: string, check: () => Promise<boolean>): Promise<"ok" | "wrong" | "locked"> {
  if (!(await reserveAttempt(ip))) return "locked";
  if (!(await check())) return "wrong";
  await clearAttempts(ip);
  return "ok";
}

export async function clearAttempts(ip: string): Promise<void> {
  await db.delete(authAttempts).where(eq(authAttempts.ip, ip));
}
