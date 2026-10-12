import { db } from "@/db/client";
import { matchVenue } from "@/lib/sources/openreview";
import { SourceUnavailable } from "@/lib/sources/types";

const TITLES = [
  "Attention Is All You Need",
  "SpikeZIP-TF: Conversion is All You Need for Transformer-based SNN",
];

export default async function run(args: string[]) {
  try {
    for (const title of args.length ? [args.join(" ")] : TITLES) {
      try {
        const match = await matchVenue(title);
        console.log(
          match
            ? `"${title}": venue=${match.venue} venueid=${match.venueid} accepted=${match.accepted}`
            : `"${title}": no match`,
        );
      } catch (error) {
        if (!(error instanceof SourceUnavailable)) throw error;
        console.log(`"${title}": SourceUnavailable (${error.message})`);
      }
    }
  } finally {
    await db.$client.end();
  }
}
