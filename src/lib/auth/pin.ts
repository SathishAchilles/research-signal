import { hash, verify } from "@node-rs/argon2";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";

// Argon2id is the library default; these are the OWASP minimums.
export const PIN_HASH_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const GENERIC_PIN_ERROR = "Incorrect PIN or too many attempts. Try again later.";

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{6}$/.test(pin);
}

export function hashPin(pin: string): Promise<string> {
  return hash(pin, PIN_HASH_OPTIONS);
}

export async function checkPin(pin: string): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  const [row] = await db
    .select({ pinHash: appSettings.pinHash })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);
  if (!row?.pinHash) return false;
  try {
    return await verify(row.pinHash, pin);
  } catch {
    return false;
  }
}

export async function storePin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error("PIN must be exactly 6 digits");
  const pinHash = await hashPin(pin);
  const updated = await db
    .update(appSettings)
    .set({ pinHash, updatedAt: sql`now()` })
    .where(eq(appSettings.id, 1))
    .returning({ id: appSettings.id });
  if (updated.length === 0) throw new Error("app_settings row is missing; run npm run seed first");
}
