"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { guardedCheck } from "@/lib/auth/backoff";
import { clientKey } from "@/lib/auth/client-key";
import { checkPin, GENERIC_PIN_ERROR } from "@/lib/auth/pin";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";

export type LoginState = { error: string } | null;

export async function verifyPin(formData: FormData): Promise<LoginState> {
  const pin = formData.get("pin");
  const result = await guardedCheck(await clientKey(), () => checkPin(typeof pin === "string" ? pin : ""));
  if (result !== "ok") return { error: GENERIC_PIN_ERROR };

  (await cookies()).set(SESSION_COOKIE, await createSession(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect("/");
}
