import type { ActionKind, BriefCard } from "@/lib/brief/types";
import { AttentionLine, CardFrame, type CardProse, CueRow, MoreDetails } from "./CardParts";

export function StandardCard({ card, prose, action }: { card: BriefCard; prose?: CardProse; action: ActionKind | null }) {
  return (
    <CardFrame card={card} action={action}>
      <CueRow card={card} />
      <h3 className="mt-1.5 font-heading leading-snug font-semibold">{prose?.headline || card.title}</h3>
      {prose?.headline ? <p className="text-xs text-muted-foreground">{card.title}</p> : null}
      {prose?.pointer || prose?.line ? <p className="mt-1 text-sm">{prose.pointer || prose.line}</p> : null}
      <p className="mt-1 text-sm">
        <span className="font-semibold">Client angle:</span> {prose?.clientAngle || card.clientAngle}
      </p>
      <AttentionLine card={card} />
      <MoreDetails abstract={card.abstract} reason={prose?.verdictReason} />
    </CardFrame>
  );
}
