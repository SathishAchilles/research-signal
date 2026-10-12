"use server";

import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { db } from "@/db/client";
import { sources, sourceKind } from "@/db/schema";
import { getSourceSecret, registry } from "@/lib/sources/registry";
import type { ConnectionResult, SourceKind } from "@/lib/sources/types";
import { hasSession, SESSION_EXPIRED } from "../_lib/guard";
import { parseParams, type ParamValues } from "./fields";

export type SourceActionResult = { ok: true } | { ok: false; error: string };

const isKind = (kind: string): kind is SourceKind => (sourceKind.enumValues as readonly string[]).includes(kind);

export async function saveSource(
  kind: string,
  input: { enabled: boolean; priority: string; params: ParamValues },
): Promise<SourceActionResult> {
  if (!(await hasSession())) return { ok: false, error: SESSION_EXPIRED };
  if (!isKind(kind)) return { ok: false, error: "Unknown source." };
  const priority = Number(input.priority);
  if (!Number.isInteger(priority) || priority < 0 || priority > 10_000) {
    return { ok: false, error: "Priority must be a whole number between 0 and 10000." };
  }
  const parsed = parseParams(kind, input.params);
  if (!parsed.ok) return parsed;

  await db
    .update(sources)
    .set({ enabled: input.enabled, priority, params: parsed.params })
    .where(eq(sources.kind, kind));
  refresh();
  return { ok: true };
}

export async function setSourceKey(kind: string, value: string): Promise<SourceActionResult> {
  if (!(await hasSession())) return { ok: false, error: SESSION_EXPIRED };
  if (!isKind(kind) || kind === "s2") return { ok: false, error: "This source does not take a key." };
  const key = value.trim();
  if (key.length < 8 || key.length > 512) return { ok: false, error: "The key looks wrong; check it and try again." };

  const [row] = await db.select({ secretName: sources.secretName }).from(sources).where(eq(sources.kind, kind));
  if (!row) return { ok: false, error: "Unknown source." };
  const name = row.secretName ?? kind;
  await db.execute(sql`select research_signal.set_source_secret(${name}, ${key})`);
  if (!row.secretName) await db.update(sources).set({ secretName: name }).where(eq(sources.kind, kind));
  refresh();
  return { ok: true };
}

export async function testSource(kind: string): Promise<ConnectionResult> {
  if (!(await hasSession())) return { ok: false, latencyMs: 0, error: SESSION_EXPIRED };
  if (!isKind(kind)) return { ok: false, latencyMs: 0, error: "Unknown source." };
  const [row] = await db.select({ params: sources.params }).from(sources).where(eq(sources.kind, kind));
  const adapter = registry[kind];
  const params = adapter.paramsSchema.safeParse(row?.params ?? {});
  if (!params.success) return { ok: false, latencyMs: 0, error: "Stored parameters are invalid; save them first." };
  return adapter.testConnection(params.data, await getSourceSecret(kind));
}
