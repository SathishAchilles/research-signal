import { db } from "@/db/client";
import { composeBrief } from "@/lib/brief/compose";
import { selectBrief } from "@/lib/brief/select";
import { totalWords, validateProse } from "@/lib/brief/validate";
import { briefWindow } from "@/lib/brief/window";

export default async function run(args: string[]) {
  try {
    const window = briefWindow(args[0] ? new Date(args[0]) : new Date());
    const selection = await selectBrief(window);
    if (Object.keys(selection.cards).length === 0) throw new Error(`no cards for ${window.isoWeek}; run the backfill first`);
    const result = await composeBrief(selection);
    if (result.source === "fallback") console.log(`fallback used (errors: ${JSON.stringify(result.errors.slice(0, 5))})`);
    else console.log(`prose source ${result.source}; first-pass errors ${result.errors.length}`);
    const errors = validateProse(result.prose, selection);
    console.log(`errors: ${JSON.stringify(result.source === "fallback" ? [] : errors)}`);
    console.log(`total prose words: ${totalWords(result.prose)}`);
    console.log(`weekLine: ${result.prose.weekLine}`);
  } finally {
    await db.$client.end();
  }
}
