import { db } from "@/db/client";
import { clearAttempts, isLocked, MAX_FAILURES, recordFailure } from "@/lib/auth/backoff";

const ATTACKER = "203.0.113.9";
const BYSTANDER = "203.0.113.10";

export default async function run() {
  try {
    await Promise.all([clearAttempts(ATTACKER), clearAttempts(BYSTANDER)]);

    for (let i = 0; i < MAX_FAILURES; i++) await recordFailure(ATTACKER);
    const attackerLocked = await isLocked(ATTACKER);
    const bystanderLocked = await isLocked(BYSTANDER);
    console.log(`${ATTACKER} locked=${attackerLocked}`);
    console.log(`${BYSTANDER} locked=${bystanderLocked}`);
    if (!attackerLocked || bystanderLocked) throw new Error("backoff did not isolate the locked address");
  } finally {
    await Promise.all([clearAttempts(ATTACKER), clearAttempts(BYSTANDER)]);
    await db.$client.end();
  }
}
