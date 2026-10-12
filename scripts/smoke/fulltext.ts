import { db } from "@/db/client";
import { getFullText } from "@/lib/sources/fulltext";

export default async function run(args: string[]) {
  try {
    const arxivId = args[0] ?? "2501.12948";
    const result = await getFullText({ arxivId, title: "" });
    if (!result) throw new Error(`no full text for ${arxivId}`);
    console.log(`${arxivId}: source=${result.source} length=${result.text.length}`);
    console.log(`starts: ${result.text.slice(0, 160)}`);
  } finally {
    await db.$client.end();
  }
}
