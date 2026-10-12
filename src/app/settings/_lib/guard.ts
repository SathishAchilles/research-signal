import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

export const SESSION_EXPIRED = "Your session has expired. Sign in again.";

export async function hasSession(): Promise<boolean> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}
