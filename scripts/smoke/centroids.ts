import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { domains } from "@/db/schema";
import { recomputeCentroids } from "@/lib/pipeline/centroids";

const norm = (v: number[]) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));

export default async function run() {
  try {
    const results = await recomputeCentroids();
    for (const r of results) {
      console.log(`domain ${r.domainId}: client flags ${r.clientFlags}, ${r.blended ? "blended 0.6/0.4" : "base only"}`);
    }

    const rows = await db
      .select({ id: domains.id, name: domains.name, active: domains.active, centroid: domains.centroid })
      .from(domains)
      .orderBy(asc(domains.id));
    for (const d of rows) {
      const c = d.centroid;
      console.log(`${d.name} (active=${d.active}): centroid ${c ? `${c.length}d, norm ${norm(c).toFixed(3)}` : "null"}`);
    }
    const missing = rows.filter((d) => d.active && !d.centroid);
    if (missing.length > 0) throw new Error(`active domains without a centroid: ${missing.map((d) => d.name).join(", ")}`);
  } finally {
    await db.$client.end();
  }
}
