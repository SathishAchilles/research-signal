import { db } from "@/db/client";
import { TIER_CAPS, RISING_CAP, selectBrief, selectionCounts } from "@/lib/brief/select";
import { briefWindow } from "@/lib/brief/window";

export default async function run(args: string[]) {
  try {
    const window = briefWindow(args[0] ? new Date(args[0]) : new Date());
    const selection = await selectBrief(window);
    console.log(`${window.isoWeek} (${window.label}): ${Object.keys(selection.cards).length} cards`);
    console.log(`top3: ${selection.top3.map((id) => `${id} ${selection.cards[id].final.toFixed(3)}`).join(", ") || "(none)"}`);
    for (const c of selectionCounts(selection)) {
      console.log(`  ${c.domain}: hero ${c.hero}/${TIER_CAPS.hero}, standard ${c.standard}/${TIER_CAPS.standard}, compact ${c.compact}/${TIER_CAPS.compact}${c.quiet ? " (quiet)" : ""}`);
      if (c.hero > TIER_CAPS.hero || c.standard > TIER_CAPS.standard || c.compact > TIER_CAPS.compact) {
        throw new Error(`${c.domain} exceeds the tier caps`);
      }
    }
    for (const d of selection.domains.filter((x) => x.quiet)) {
      console.log(`  quiet ${d.name}: nearest miss ${d.nearestMiss ? `${d.nearestMiss.final.toFixed(3)} ${d.nearestMiss.title}` : "none"}`);
    }
    console.log(`rising: ${selection.rising.length}/${RISING_CAP}`);
    if (selection.rising.length > RISING_CAP) throw new Error("rising lane over its cap");
    console.log(`source health: ${selection.sourceHealth.map((h) => `${h.kind} ${h.status}`).join(", ") || "all OK"}`);
  } finally {
    await db.$client.end();
  }
}
