import type { ReactNode } from "react";
import type { ActionKind } from "@/lib/brief/types";
import { AttentionLine, CardFrame, type CardLike, CueRow } from "./CardParts";

// One-line paper row, also used for search hits.
export function CompactRow({ card, action = null, children }: { card: CardLike; action?: ActionKind | null; children?: ReactNode }) {
  return (
    <CardFrame card={card} action={action} className="py-2">
      <CueRow card={card} />
      <p className="mt-1 text-sm leading-snug font-medium">{card.title}</p>
      {children}
      <AttentionLine card={card} />
    </CardFrame>
  );
}
