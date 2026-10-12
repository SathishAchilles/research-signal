import { asc, sql } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { sources } from "@/db/schema";
import { registry } from "@/lib/sources/registry";
import { paramFields, toFormValues } from "./fields";
import { SourceCard, type SourceView } from "./source-card";

const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

function health(lastRunAt: Date | null, lastStatus: string | null): SourceView["health"] {
  if (!lastRunAt || Date.now() - lastRunAt.getTime() > STALE_AFTER_MS) return "STALE";
  return lastStatus === "OK" || lastStatus === "PARTIAL" || lastStatus === "FAILED" || lastStatus === "SKIPPED"
    ? lastStatus
    : "STALE";
}

async function hasVaultKey(name: string): Promise<boolean> {
  const [row] = await db.execute<{ present: boolean }>(
    sql`select research_signal.get_source_secret(${name}) is not null as present`,
  );
  return row?.present === true;
}

async function Sources() {
  await connection();
  const rows = await db.select().from(sources).orderBy(asc(sources.priority));
  const views: SourceView[] = await Promise.all(
    rows.map(async (row) => {
      const fields = paramFields(row.kind);
      const parsed = registry[row.kind].paramsSchema.safeParse(row.params ?? {});
      const params = (parsed.success ? parsed.data : row.params) as Record<string, unknown>;
      const takesKey = row.secretName !== null;
      return {
        kind: row.kind,
        role: row.role,
        enabled: row.enabled,
        priority: row.priority,
        fields,
        values: toFormValues(fields, params),
        takesKey,
        keySet: takesKey ? await hasVaultKey(row.secretName ?? row.kind) : false,
        health: health(row.lastRunAt, row.lastStatus),
        lastRunAt: row.lastRunAt?.toISOString() ?? null,
        lastError: row.lastError,
        lastItemCount: row.lastItemCount,
      };
    }),
  );
  if (views.length === 0) return <p className="text-sm text-muted-foreground">No sources. Run npm run seed.</p>;
  return (
    // Status lines inside each source card read at 14px below lg.
    <div className="grid gap-3 md:grid-cols-2 touch:[&_p.text-xs]:text-sm">
      {views.map((view) => (
        <SourceCard key={view.kind} source={view} />
      ))}
    </div>
  );
}

export default function SourcesPage() {
  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Enable, prioritise and configure each source. Keys are write-only. Health is stale when a source has not run
        in 36 hours.
      </p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading sources…</p>}>
        <Sources />
      </Suspense>
    </section>
  );
}
