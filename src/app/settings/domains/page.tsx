import { asc } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { domains } from "@/db/schema";
import { DomainList } from "./domain-list";

async function Domains() {
  await connection();
  const rows = await db
    .select({
      id: domains.id,
      name: domains.name,
      description: domains.description,
      keywords: domains.keywords,
      excludes: domains.excludes,
      arxivCategories: domains.arxivCategories,
      venues: domains.venues,
      active: domains.active,
      centroidUpdatedAt: domains.centroidUpdatedAt,
    })
    .from(domains)
    .orderBy(asc(domains.name));
  return (
    <DomainList
      domains={rows.map((d) => ({ ...d, centroidUpdatedAt: d.centroidUpdatedAt?.toISOString() ?? null }))}
    />
  );
}

export default function DomainsPage() {
  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Domains decide what each daily run shortlists. Changes apply from the next ingest; saving recomputes the
        domain centroid.
      </p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading domains…</p>}>
        <Domains />
      </Suspense>
    </section>
  );
}
