"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db } from "@/db/client";
import { domains } from "@/db/schema";
import { recomputeCentroid } from "@/lib/pipeline/centroids";
import { errorMessage } from "@/lib/sources/types";
import { hasSession, SESSION_EXPIRED } from "../_lib/guard";
import { validateDomain } from "../_lib/validation";

export type DomainFormValues = {
  name: string;
  description: string;
  keywords: string;
  excludes: string;
  arxivCategories: string;
  venues: string;
  active: boolean;
};

export type DomainActionResult = { ok: true; warning?: string } | { ok: false; error: string };

function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error && "cause" in error ? error.cause : error;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23505";
}

export async function saveDomain(id: number | null, values: DomainFormValues): Promise<DomainActionResult> {
  if (!(await hasSession())) return { ok: false, error: SESSION_EXPIRED };
  const result = validateDomain(values);
  if (!result.ok) return result;

  let domainId: number;
  try {
    if (id === null) {
      const [row] = await db.insert(domains).values(result.value).returning({ id: domains.id });
      domainId = row.id;
    } else {
      const [row] = await db.update(domains).set(result.value).where(eq(domains.id, id)).returning({ id: domains.id });
      if (!row) return { ok: false, error: "That domain no longer exists." };
      domainId = row.id;
    }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: `A domain named "${result.value.name}" already exists.` };
    throw error;
  }

  let warning: string | undefined;
  try {
    await recomputeCentroid(domainId);
  } catch (error) {
    warning = `Saved, but the centroid could not be recomputed: ${errorMessage(error)}`;
  }
  refresh();
  return { ok: true, warning };
}

export async function setDomainActive(id: number, active: boolean): Promise<DomainActionResult> {
  if (!(await hasSession())) return { ok: false, error: SESSION_EXPIRED };
  await db.update(domains).set({ active }).where(eq(domains.id, id));
  refresh();
  return { ok: true };
}

export async function deleteDomain(id: number): Promise<DomainActionResult> {
  if (!(await hasSession())) return { ok: false, error: SESSION_EXPIRED };
  await db.delete(domains).where(eq(domains.id, id));
  refresh();
  return { ok: true };
}
