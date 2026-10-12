"use server";

import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { hasSession, SESSION_EXPIRED } from "../_lib/guard";
import { validateDelivery } from "../_lib/validation";

export type DeliveryResult = { ok: true } | { ok: false; error: string };

export async function saveDelivery(input: {
  recipients: string;
  sendLocalTime: string;
  timezone: string;
}): Promise<DeliveryResult> {
  if (!(await hasSession())) return { ok: false, error: SESSION_EXPIRED };
  const result = validateDelivery(input);
  if (!result.ok) return result;
  const [row] = await db
    .update(appSettings)
    .set({ ...result.value, updatedAt: sql`now()` })
    .where(eq(appSettings.id, 1))
    .returning({ id: appSettings.id });
  if (!row) return { ok: false, error: "Settings row is missing; run npm run seed." };
  refresh();
  return { ok: true };
}
