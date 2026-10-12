"use server";

import { cookies } from "next/headers";
import { checkPin, isValidPin, storePin } from "@/lib/auth/pin";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

export type ChangePinResult = { ok: true } | { ok: false; error: string };

export async function changePin(current: string, next: string, confirm: string): Promise<ChangePinResult> {
  if (!(await readSession((await cookies()).get(SESSION_COOKIE)?.value))) {
    return { ok: false, error: "Your session has expired. Sign in again." };
  }
  if (!isValidPin(next)) return { ok: false, error: "The new PIN must be exactly 6 digits." };
  if (next !== confirm) return { ok: false, error: "The new PIN entries do not match." };
  if (!(await checkPin(current))) return { ok: false, error: "The current PIN is incorrect." };

  await storePin(next);
  return { ok: true };
}
