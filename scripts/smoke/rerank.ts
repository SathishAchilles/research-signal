import { db } from "@/db/client";
import { finalRerank } from "@/lib/brief/rerank";
import { selectBrief } from "@/lib/brief/select";
import { briefWindow } from "@/lib/brief/window";

export default async function run(args: string[]) {
  try {
    const window = briefWindow(args[0] ? new Date(args[0]) : new Date());
    const selection = await selectBrief(window);
    const changes = await finalRerank(selection);
    console.log(`${window.isoWeek}: re-judged ${changes.length} FINALIST papers`);
    for (const c of changes) {
      console.log(
        `  ${c.cardId} ${c.before.toFixed(3)} -> ${c.after.toFixed(3)}  ${c.signalType.join("->")} novelty ${c.novelty.join("->")}` +
          `  full text ${c.fullText ? "yes" : "no"}  ${c.title.slice(0, 60)}`,
      );
    }
  } finally {
    await db.$client.end();
  }
}
