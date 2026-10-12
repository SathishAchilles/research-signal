import type { ActionKind, BriefCard } from "@/lib/brief/types";
import { AttentionLine, CardFrame, type CardProse, CueRow, MoreDetails, TitleLink } from "./CardParts";

// Below lg and on touch: 44px source links, 14px detail text, and an anchor offset that clears the
// sticky nav plus the taller chips bar.
export const CARD_TOUCH = "tap-links scroll-mt-36 touch:[&_details_p]:text-sm";

export function StandardCard({ card, prose, action }: { card: BriefCard; prose?: CardProse; action: ActionKind | null }) {
  return (
    <CardFrame card={card} action={action} className={CARD_TOUCH}>
      <CueRow card={card} />
      <h3 className="mt-1.5 font-heading leading-snug font-semibold">
        <TitleLink paperId={card.paperId}>{prose?.headline || card.title}</TitleLink>
      </h3>
      {prose?.headline ? <p className="text-sm text-muted-foreground lg:text-xs">{card.title}</p> : null}
      {prose?.pointer || prose?.line ? <p className="mt-1 text-sm">{prose.pointer || prose.line}</p> : null}
      <p className="mt-1 text-sm">
        <span className="font-semibold">Client angle:</span> {prose?.clientAngle || card.clientAngle}
      </p>
      <AttentionLine card={card} />
      <MoreDetails abstract={card.abstract} reason={prose?.verdictReason} />
    </CardFrame>
  );
}
