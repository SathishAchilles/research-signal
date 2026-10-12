import type { ReactNode } from "react";
import type { ActionKind } from "@/lib/brief/types";
import { AttentionLine, CardFrame, type CardLike, CueRow } from "./CardParts";
import { CARD_TOUCH } from "./StandardCard";

// One-line paper row, also used for search hits.
export function CompactRow({ card, action = null, children }: { card: CardLike; action?: ActionKind | null; children?: ReactNode }) {
  return (
    <CardFrame card={card} action={action} className={`py-2 ${CARD_TOUCH}`}>
      <CueRow card={card} />
      <p className="mt-1 font-heading text-sm leading-snug font-medium">{card.title}</p>
      {children}
      <AttentionLine card={card} />
    </CardFrame>
  );
}
