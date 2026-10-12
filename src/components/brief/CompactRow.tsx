import type { ReactNode } from "react";
import { attentionText, COLORS_UI, VERDICT_LABEL } from "@/lib/brief/cues";
import { formatCount, formatPercent } from "@/lib/brief/tokens";
import type { ActionKind } from "@/lib/brief/types";
import { CardActions } from "./CardActions";
import { CardFrame, type CardLike, TitleLink } from "./CardParts";
import { EvidenceMeter } from "./EvidenceMeter";
import { SignalChip } from "./SignalChip";

// One-line paper row, also used for search hits. Desktop: verdict pill, title link, rung, signal,
// HF count and icon actions on one line. Touch (coarse pointer or below lg): the verdict and title on
// line one, the cues and 44px actions on line two; the rung word drops to screen-reader-only there.
// Source links live on the paper page the title opens; the full attention line is the HF count's tooltip.
export function CompactRow({ card, action = null, children }: { card: CardLike; action?: ActionKind | null; children?: ReactNode }) {
  const color = COLORS_UI.verdict[card.verdict];
  const rising = card.tier === "RISING" && card.evidence.rising_pct != null;
  const hf = card.evidence.hf_upvotes;
  return (
    <CardFrame card={card} action={action} compact className="scroll-mt-36 py-1 lg:py-0.5 touch:py-1">
      <div className="flex flex-wrap items-center gap-x-2.5 lg:flex-nowrap">
        <span
          className="shrink-0 rounded-full border px-1.5 font-mono text-[10.5px] leading-4 font-medium tracking-[.08em] whitespace-nowrap"
          style={{ color, borderColor: color }}
        >
          {VERDICT_LABEL[card.verdict]}
        </span>
        <TitleLink
          paperId={card.paperId}
          className="flex min-h-7 min-w-0 flex-1 items-center font-heading text-sm leading-snug font-medium touch:min-h-11"
        >
          <span className="truncate" title={card.title}>
            {card.title}
          </span>
        </TitleLink>
        <div className="flex min-w-0 basis-full flex-wrap items-center gap-x-2.5 lg:basis-auto lg:shrink-0 lg:flex-nowrap">
          <span className="shrink-0 touch:[&>span>span:last-child]:sr-only">
            <EvidenceMeter rung={card.rung} />
          </span>
          <span className="shrink-0">
            <SignalChip signal={card.signalType} />
          </span>
          {rising ? (
            <span className="shrink-0 font-mono text-xs font-medium" style={{ color: COLORS_UI.rising }}>
              UP {formatPercent(card.evidence.rising_pct!)}
            </span>
          ) : null}
          <span className="num shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground" title={attentionText(card)}>
            {hf == null ? "HF —" : `HF ${formatCount(hf)}`}
          </span>
          <div className="ml-auto lg:ml-1">
            <CardActions paperId={card.paperId} initial={action} variant="icon" />
          </div>
        </div>
      </div>
      {children ? <div className="tap-links">{children}</div> : null}
    </CardFrame>
  );
}
