import type { ActionKind, BriefCard } from "@/lib/brief/types";
import { AttentionLine, CardFrame, type CardProse, CueRow, MoreDetails } from "./CardParts";

export function HeroCard({ card, prose, action }: { card: BriefCard; prose?: CardProse; action: ActionKind | null }) {
  return (
    <CardFrame card={card} action={action} className="border-2">
      <CueRow card={card} />
      <h3 className="mt-2 text-lg leading-snug font-semibold">{prose?.headline || card.title}</h3>
      {prose?.headline ? <p className="text-sm text-muted-foreground">{card.title}</p> : null}
      {prose?.lede ? <p className="mt-2">{prose.lede}</p> : null}
      <p className="mt-2 text-sm">
        <span className="font-semibold">Client angle:</span> {prose?.clientAngle || card.clientAngle}
      </p>
      <AttentionLine card={card} />
      <MoreDetails abstract={card.abstract} reason={prose?.verdictReason} />
    </CardFrame>
  );
}
