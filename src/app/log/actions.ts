"use server";

import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { updateActionNote } from "@/lib/brief/log";

export type UpdateActionResult = { ok: boolean; error?: string };

export async function updateAction(paperId: string, note: string, clientTag: string): Promise<UpdateActionResult> {
  if (!(await readSession((await cookies()).get(SESSION_COOKIE)?.value))) {
    return { ok: false, error: "Your session has expired. Sign in again." };
  }
  if (!/^[0-9a-f-]{36}$/i.test(paperId)) return { ok: false, error: "Unknown paper." };
  return updateActionNote(paperId, note, clientTag);
}
