"use server";

import { cookies } from "next/headers";
import { guardedCheck } from "@/lib/auth/backoff";
import { clientKey } from "@/lib/auth/client-key";
import { checkPin, isValidPin, storePin } from "@/lib/auth/pin";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

export type ChangePinResult = { ok: true } | { ok: false; error: string };

export async function changePin(current: string, next: string, confirm: string): Promise<ChangePinResult> {
  if (!(await readSession((await cookies()).get(SESSION_COOKIE)?.value))) {
    return { ok: false, error: "Your session has expired. Sign in again." };
  }
  if (!isValidPin(next)) return { ok: false, error: "The new PIN must be exactly 6 digits." };
  if (next !== confirm) return { ok: false, error: "The new PIN entries do not match." };
  const result = await guardedCheck(await clientKey(), () => checkPin(current));
  if (result === "locked") return { ok: false, error: "Too many incorrect attempts. Try again later." };
  if (result === "wrong") return { ok: false, error: "The current PIN is incorrect." };

  await storePin(next);
  return { ok: true };
}
