import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { desc, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { briefs } from "@/db/schema";
import { EMAIL_BYTE_LIMIT, renderEmail } from "@/lib/brief/email";
import type { BriefCard, BriefDoc, Tier } from "@/lib/brief/types";
import { briefWindow } from "@/lib/brief/window";

const VERDICTS = ["CLIENT", "READ", "SKIP"] as const;
const RUNGS = ["LAB", "CODE", "MODEL", "PEER"] as const;
const SIGNALS = ["BENCH", "EVAL", "REFRAME", "METHOD"] as const;

// A synthetic brief with every tier filled, so size and cues can be checked without data.
function fixture(domainCount: number): BriefDoc {
  const window = briefWindow(new Date("2026-10-11T12:00:00Z"));
  const cards: Record<string, BriefCard> = {};
  const card = (domainId: number, tier: Tier): string => {
    const n = Object.keys(cards).length + 1;
    const cardId = `p${n}`;
    cards[cardId] = {
      cardId,
      paperId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      arxivId: `2610.${String(n).padStart(5, "0")}`,
      domainId,
      tier,
      inTop3: false,
      title: `A long and careful paper title about agents, retrieval and evaluation number ${n}`,
      abstract: "We study how retrieval changes agent behaviour on long tasks. Results are mixed.",
      status: "FINALIST",
      final: 0.75 - n * 0.003,
      verdict: VERDICTS[n % 3],
      rung: RUNGS[n % 4],
      signalType: SIGNALS[n % 4],
      novelty: 3,
      llmRelevance: 4,
      cosine: 0.6,
      clientAngle: "Shows where retrieval helps agents and where it quietly hurts accuracy.",
      links: { abs: "https://arxiv.org/abs/2610.00001", pdf: "https://arxiv.org/pdf/2610.00001", code: "https://github.com/x/y", hf: "https://huggingface.co/papers/2610.00001" },
      evidence: { hf_upvotes: 412, github_stars: 1234, linked: 2, s2_citations: 3, rising_pct: tier === "RISING" ? 38 : null, final_score: 0.7 },
    };
    return cardId;
  };
  const domains = Array.from({ length: domainCount }, (_, i) => {
    const domainId = i + 1;
    return {
      domainId,
      name: `Domain ${domainId}`,
      slug: `d${domainId}`,
      hero: card(domainId, "HERO"),
      standard: [card(domainId, "STANDARD"), card(domainId, "STANDARD")],
      compact: Array.from({ length: 5 }, () => card(domainId, "COMPACT")),
      quiet: false,
      nearestMiss: null,
    };
  });
  const top3 = ["p1", "p9", "p17"].filter((id) => cards[id]);
  for (const id of top3) cards[id].inTop3 = true;
  const rising = Array.from({ length: 6 }, () => card(1, "RISING"));
  return {
    version: 1,
    briefId: "00000000-0000-4000-8000-0000000000ff",
    generatedAt: new Date().toISOString(),
    proseSource: "fallback",
    selection: { isoWeek: window.isoWeek, windowStart: window.start.toISOString(), windowEnd: window.end.toISOString(), label: window.label, cards, top3, domains, rising, sourceHealth: [{ kind: "openreview", status: "FAILED", note: "Unavailable at times. OpenReview: venue status may be missing." }] },
    prose: {
      weekLine: "Retrieval-heavy agents dominated the week, with two strong new benchmarks.",
      top3: top3.map((id) => ({ cardId: id, pointer: "The clearest evidence this week that retrieval changes agent reliability.", evidenceRefs: [`${id}.hf_upvotes`] })),
      domains: domains.map((d) => ({
        domainId: d.domainId,
        situation: "Agents kept growing more capable.",
        complication: "New evaluations show retrieval errors compound.",
        implication: "Clients should test retrieval before scaling agents.",
        cards: [d.hero, ...d.standard].map((id) => ({ cardId: id, headline: "Retrieval errors compound across agent steps", lede: cards[id].tier === "HERO" ? "A careful study across many long tasks shows small retrieval misses grow into failed runs." : undefined, clientAngle: "Audit retrieval quality before buying more agent capacity.", verdictReason: "Strong evidence with released code.", evidenceRefs: [`${id}.github_stars`] })),
      })),
      rising: rising.map((id) => ({ cardId: id, line: "Attention jumped after a public demo.", evidenceRefs: [`${id}.rising_pct`] })),
    },
  };
}

export default async function run(args: string[]) {
  try {
    const [latest] = args.includes("--fixture")
      ? []
      : await db.select({ json: briefs.json }).from(briefs).where(isNotNull(briefs.json)).orderBy(desc(briefs.windowStart)).limit(1);
    const doc = (latest?.json as BriefDoc | undefined) ?? fixture(4);
    const out = renderEmail(doc);
    // Previews go outside the repo so each run does not churn the tracked tmp/email-preview.html.
    const file = process.env.EMAIL_PREVIEW_PATH ?? path.join(os.tmpdir(), "research-signal", "email-preview.html");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, out.html);
    console.log(`${latest ? `brief ${doc.selection.isoWeek} from the database` : "fixture brief"}: wrote ${file}`);
    console.log(`bytes ${out.bytes} (limit ${EMAIL_BYTE_LIMIT}), moved to the web: ${out.webOnly.join(", ") || "nothing"}`);
    if (out.bytes >= EMAIL_BYTE_LIMIT) throw new Error("email is over the byte limit");
    for (const cue of ["BRING TO CLIENT", "READ", "SKIP", "[#---] LAB", "[####] PEER", "BENCH", "EVAL", "REFRAME", "METHOD"]) {
      if (!latest && !out.html.includes(cue)) throw new Error(`text cue missing: ${cue}`);
    }
    if (/<img|<script/i.test(out.html)) throw new Error("email contains images or scripts");

    for (const domains of [10, 20]) {
      const large = renderEmail(fixture(domains));
      console.log(`fixture with ${domains} full domains: bytes ${large.bytes}, moved to the web: ${large.webOnly.join(", ") || "nothing"}`);
      if (!large.compactOnWeb || !large.html.includes("more on the web")) throw new Error("large brief did not move compact rows to the web");
      if (large.bytes >= EMAIL_BYTE_LIMIT) throw new Error("large brief is still over the byte limit");
    }
  } finally {
    await db.$client.end();
  }
}
