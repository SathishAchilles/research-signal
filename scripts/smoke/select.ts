import { db } from "@/db/client";
import { fallbackProse } from "@/lib/brief/fallback";
import { TIER_CAPS, RISING_CAP, selectBrief, selectionCounts } from "@/lib/brief/select";
import { validateProse } from "@/lib/brief/validate";
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
    for (const d of selection.domains) {
      const placed = Boolean(d.hero) || d.standard.length + d.compact.length > 0;
      if (d.quiet === placed) throw new Error(`${d.name}: quiet must mean no paper placed in the domain`);
    }
    // The fallback's domain intros must pass the validator (card lines may quote titles with digits).
    const fallback = fallbackProse(selection);
    const introErrors = validateProse(fallback, selection).filter((e) => e.startsWith("domain ") && !e.includes(" card "));
    for (const d of fallback.domains) {
      console.log(`  fallback d${d.domainId}: ${d.situation} ${d.complication} ${d.implication}`);
    }
    if (introErrors.length) throw new Error(`fallback domain intros break the rules: ${introErrors.join("; ")}`);
    const refErrors = (errors: string[]) => errors.filter((e) => e.includes("evidenceRef"));
    if (refErrors(validateProse(fallback, selection)).length) throw new Error("fallback evidenceRefs rejected");
    const firstCard = fallback.domains.flatMap((d) => d.cards)[0];
    if (firstCard) {
      const bad = { ...fallback, domains: fallback.domains.map((d) => ({ ...d, cards: d.cards.map((c) => (c === firstCard ? { ...c, evidenceRefs: ["p999.final_score", `${c.cardId}.bogus`] } : c)) })) };
      const got = refErrors(validateProse(bad, selection));
      if (got.length !== 2 || !got[0].includes("unknown card p999") || !got[1].includes("unknown field bogus")) {
        throw new Error(`evidenceRefs check: expected unknown card and unknown field, got ${JSON.stringify(got)}`);
      }
      console.log("evidenceRefs: unknown card and unknown field rejected");
    }
    console.log(`rising: ${selection.rising.length}/${RISING_CAP}`);
    if (selection.rising.length > RISING_CAP) throw new Error("rising lane over its cap");
    console.log(`source health: ${selection.sourceHealth.map((h) => `${h.kind} ${h.status}`).join(", ") || "all OK"}`);
  } finally {
    await db.$client.end();
  }
}
