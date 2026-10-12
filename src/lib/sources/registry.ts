import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sources } from "@/db/schema";
import { env } from "@/lib/env";
import { aclAdapter } from "./acl";
import { arxivAdapter } from "./arxiv";
import { cvfAdapter } from "./cvf";
import { coreAdapter, unpaywallAdapter } from "./fulltext";
import { hfAdapter } from "./hf";
import { openreviewAdapter } from "./openreview";
import { pmlrAdapter } from "./pmlr";
import { s2Adapter } from "./s2";
import type { SourceAdapter, SourceKind, SourceRole } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const registry: Record<SourceKind, SourceAdapter<any>> = {
  arxiv: arxivAdapter,
  hf: hfAdapter,
  openreview: openreviewAdapter,
  s2: s2Adapter,
  acl: aclAdapter,
  cvf: cvfAdapter,
  pmlr: pmlrAdapter,
  unpaywall: unpaywallAdapter,
  core: coreAdapter,
};

export type EnabledSource = {
  kind: SourceKind;
  role: SourceRole;
  priority: number;
  secretName: string | null;
  params: unknown;
};

// Enabled sources (optionally for one role) in priority order, with params parsed and defaulted.
export async function getEnabledSources(role?: SourceRole): Promise<EnabledSource[]> {
  const rows = await db
    .select()
    .from(sources)
    .where(role ? and(eq(sources.enabled, true), eq(sources.role, role)) : eq(sources.enabled, true))
    .orderBy(asc(sources.priority));
  return rows.map((row) => ({
    kind: row.kind,
    role: row.role,
    priority: row.priority,
    secretName: row.secretName,
    params: registry[row.kind].paramsSchema.parse(row.params ?? {}),
  }));
}

const ENV_FALLBACK: Partial<Record<SourceKind, string | undefined>> = {
  hf: env.HF_TOKEN,
  core: env.CORE_API_KEY,
};

// Vault secrets are stored as rs_src_<name>; get_source_secret adds that prefix itself.
// Semantic Scholar is keyless and never gets a secret.
export async function getSourceSecret(kind: SourceKind): Promise<string | undefined> {
  if (kind === "s2") return undefined;
  const [row] = await db.select({ secretName: sources.secretName }).from(sources).where(eq(sources.kind, kind));
  const name = row?.secretName ?? kind;
  const [result] = await db.execute<{ secret: string | null }>(
    sql`select research_signal.get_source_secret(${name}) as secret`,
  );
  return result?.secret || ENV_FALLBACK[kind] || undefined;
}
