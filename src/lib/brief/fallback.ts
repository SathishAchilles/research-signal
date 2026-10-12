import type { SignalType } from "@/lib/pipeline/rank";
import type { BriefCard, BriefProse, BriefSelection, DomainSelection } from "./types";

const VERDICT_TEXT = { CLIENT: "Bring to client", READ: "Worth a read", SKIP: "Skim only" } as const;

function firstSentence(text: string): string {
  const match = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (match ? match[0] : text).replace(/\s+/g, " ").trim();
}

const words = (text: string, max: number) => text.split(/\s+/).filter(Boolean).slice(0, max).join(" ");

const refsFor = (card: BriefCard) => [`${card.cardId}.final_score`];

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const SIGNAL_PLURAL: Record<SignalType, string> = {
  BENCH: "new benchmarks",
  EVAL: "evaluation results",
  REFRAME: "reframings of known problems",
  METHOD: "new methods",
};
const RUNG_TEXT: Record<BriefCard["rung"], string> = {
  LAB: "The lead paper has no released code or models yet.",
  CODE: "The lead paper has released code but no released models.",
  MODEL: "The lead paper has released models but no peer review yet.",
  PEER: "The lead paper has already passed peer review.",
};
const IMPLICATION_TEXT: Record<BriefCard["verdict"], string> = {
  CLIENT: "Worth raising with clients this week.",
  READ: "Worth reading before client conversations; no client action yet.",
  SKIP: "Skim for awareness; no client action needed.",
};

// Situation, complication and implication from stored fields only: counts in words, the most common
// signal type, the lead card's evidence rung and verdict. No digits and well under the 40-word cap.
function domainIntro(d: DomainSelection, cards: BriefSelection["cards"]) {
  const listed = [d.hero, ...d.standard, ...d.compact].filter((id): id is string => Boolean(id)).map((id) => cards[id]);
  const lead = listed[0];
  if (d.quiet || !lead) {
    return {
      situation: "No paper landed in this domain this week.",
      complication: d.nearestMiss ? "Its nearest miss is listed below with its score." : "Nothing in the window was scored for it.",
      implication: "No client action from this domain.",
    };
  }
  const tally = new Map<SignalType, number>();
  for (const card of listed) tally.set(card.signalType, (tally.get(card.signalType) ?? 0) + 1);
  // Stable sort: on a tie the signal type seen first (the higher-ranked card) wins.
  const [signal] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  const count = COUNT_WORDS[listed.length] ?? "Several";
  return {
    situation: `${count} ${listed.length === 1 ? "paper" : "papers"} cleared the bar, mostly ${SIGNAL_PLURAL[signal]}.`,
    complication: RUNG_TEXT[lead.rung],
    implication: IMPLICATION_TEXT[lead.verdict],
  };
}

// Deterministic prose built only from stored data: titles, first abstract sentences and stored client angles.
export function fallbackProse(selection: BriefSelection): BriefProse {
  const cards = selection.cards;
  const lead = selection.top3[0] ? cards[selection.top3[0]] : undefined;
  return {
    weekLine: lead ? `Strongest signal this week: ${words(lead.title, 18)}.` : "A quiet week across the tracked domains.",
    top3: selection.top3.map((id) => ({
      cardId: id,
      pointer: words(firstSentence(cards[id].abstract), 30),
      evidenceRefs: refsFor(cards[id]),
    })),
    domains: selection.domains.map((d) => {
      const listed = [d.hero, ...d.standard].filter((id): id is string => Boolean(id));
      return {
        domainId: d.domainId,
        ...domainIntro(d, cards),
        cards: listed.map((id) => {
          const card = cards[id];
          return {
            cardId: id,
            headline: words(card.title, 10),
            lede: card.tier === "HERO" ? words(firstSentence(card.abstract), 22) : undefined,
            clientAngle: card.clientAngle,
            verdictReason: `${VERDICT_TEXT[card.verdict]}; evidence ${card.rung}.`,
            evidenceRefs: refsFor(card),
          };
        }),
      };
    }),
    rising: selection.rising.map((id) => ({
      cardId: id,
      line: `Hugging Face upvotes {{ev:${id}.rising_pct}} week on week since it was first sent.`,
      evidenceRefs: [`${id}.rising_pct`],
    })),
  };
}
