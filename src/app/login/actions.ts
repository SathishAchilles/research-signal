"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clearAttempts, isLocked, recordFailure } from "@/lib/auth/backoff";
import { checkPin, GENERIC_PIN_ERROR } from "@/lib/auth/pin";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";

export type LoginState = { error: string } | null;

async function clientIp(): Promise<string> {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || list.get("x-real-ip")?.trim() || "unknown";
}

export async function verifyPin(formData: FormData): Promise<LoginState> {
  const ip = await clientIp();
  if (await isLocked(ip)) return { error: GENERIC_PIN_ERROR };

  const pin = formData.get("pin");
  if (typeof pin !== "string" || !(await checkPin(pin))) {
    await recordFailure(ip);
    return { error: GENERIC_PIN_ERROR };
  }

  await clearAttempts(ip);
  (await cookies()).set(SESSION_COOKIE, await createSession(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect("/");
}
