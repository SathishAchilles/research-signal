import { db } from "@/db/client";
import { clearAttempts, guardedCheck, isLocked, MAX_FAILURES, reserveAttempt } from "@/lib/auth/backoff";
import { checkPin } from "@/lib/auth/pin";

const ATTACKER = "203.0.113.9";
const BYSTANDER = "203.0.113.10";
const BURST = "203.0.113.11";
const BURST_SIZE = 10;

// A six-digit PIN that checkPin rejects, found before the burst so the burst's own count is exact.
async function wrongPin(): Promise<string> {
  for (const candidate of ["000000", "123456", "999999", "314159"]) {
    if (!(await checkPin(candidate))) return candidate;
  }
  throw new Error("could not find a wrong PIN");
}

export default async function run() {
  const keys = [ATTACKER, BYSTANDER, BURST];
  try {
    await Promise.all(keys.map(clearAttempts));

    for (let i = 0; i < MAX_FAILURES; i++) {
      if (!(await reserveAttempt(ATTACKER))) throw new Error(`reservation ${i + 1} was refused before the limit`);
    }
    const attackerLocked = await isLocked(ATTACKER);
    const bystanderLocked = await isLocked(BYSTANDER);
    const sixthGranted = await reserveAttempt(ATTACKER);
    console.log(`${ATTACKER} locked=${attackerLocked} sixthGranted=${sixthGranted}`);
    console.log(`${BYSTANDER} locked=${bystanderLocked}`);
    if (!attackerLocked || bystanderLocked || sixthGranted) {
      throw new Error("backoff did not isolate the locked address");
    }

    const pin = await wrongPin();
    let verifications = 0;
    const results = await Promise.all(
      Array.from({ length: BURST_SIZE }, () =>
        guardedCheck(BURST, () => {
          verifications++;
          return checkPin(pin);
        }),
      ),
    );
    const locked = results.filter((result) => result === "locked").length;
    console.log(`burst of ${BURST_SIZE}: verifications=${verifications} locked=${locked} keyLocked=${await isLocked(BURST)}`);
    if (verifications > MAX_FAILURES || results.includes("ok")) {
      throw new Error(`parallel burst ran ${verifications} PIN verifications; the limit is ${MAX_FAILURES}`);
    }
  } finally {
    await Promise.all(keys.map(clearAttempts));
    await db.$client.end();
  }
}
