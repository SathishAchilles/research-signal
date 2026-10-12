import type { BriefCard, BriefProse, BriefSelection } from "./types";

const VERDICT_TEXT = { CLIENT: "Bring to client", READ: "Worth a read", SKIP: "Skim only" } as const;

function firstSentence(text: string): string {
  const match = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (match ? match[0] : text).replace(/\s+/g, " ").trim();
}

const words = (text: string, max: number) => text.split(/\s+/).filter(Boolean).slice(0, max).join(" ");

const refsFor = (card: BriefCard) => [`${card.cardId}.final_score`];

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
        situation: d.quiet ? "Nothing cleared the bar this week." : "",
        complication: d.quiet && d.nearestMiss ? `Nearest miss: ${words(d.nearestMiss.title, 14)}.` : "",
        implication: "",
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
