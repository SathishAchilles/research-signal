import type { ReactNode } from "react";
import { attentionText, COLORS } from "@/lib/brief/cues";
import { formatPercent } from "@/lib/brief/tokens";
import type { ActionKind, BriefCard } from "@/lib/brief/types";
import { CardActions } from "./CardActions";
import { EvidenceMeter } from "./EvidenceMeter";
import { SignalChip } from "./SignalChip";
import { VerdictBar, VerdictLabel } from "./VerdictBar";

export type CardLike = Pick<BriefCard, "paperId" | "title" | "verdict" | "rung" | "signalType" | "evidence" | "links"> & {
  cardId?: string;
  tier?: BriefCard["tier"];
};

export type CardProse = { headline?: string; lede?: string; clientAngle?: string; verdictReason?: string; line?: string; pointer?: string };

// Focusable card shell used by every tier; j/k move between [data-card] elements.
export function CardFrame({ card, action, children, className = "" }: { card: CardLike; action: ActionKind | null; children: ReactNode; className?: string }) {
  return (
    <article
      id={card.cardId ? `card-${card.cardId}` : undefined}
      data-card
      data-paper-id={card.paperId}
      tabIndex={0}
      className={`relative rounded-md border bg-card py-3 pr-3 pl-4 outline-offset-2 focus-visible:outline-3 focus-visible:outline-[#0072B2] ${className}`}
    >
      <VerdictBar verdict={card.verdict} />
      {children}
      <div className="mt-2">
        <CardActions paperId={card.paperId} initial={action} />
      </div>
    </article>
  );
}

export function CueRow({ card }: { card: CardLike }) {
  const rising = card.tier === "RISING" && card.evidence.rising_pct != null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <VerdictLabel verdict={card.verdict} />
      <EvidenceMeter rung={card.rung} />
      <SignalChip signal={card.signalType} />
      {rising ? (
        <span className="text-xs font-bold" style={{ color: COLORS.rising }}>
          UP {formatPercent(card.evidence.rising_pct!)}
        </span>
      ) : null}
    </div>
  );
}

export function AttentionLine({ card }: { card: CardLike }) {
  const links = [
    ["Abstract", card.links.abs],
    ["PDF", card.links.pdf],
    ["Code", card.links.code],
    ["HF", card.links.hf],
  ].filter((l): l is [string, string] => Boolean(l[1]));
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{attentionText(card)}</span>
      {links.map(([label, href]) => (
        <a key={label} href={href} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
          {label}
        </a>
      ))}
    </div>
  );
}

// Enter on a focused card toggles this.
export function MoreDetails({ abstract, reason }: { abstract: string; reason?: string }) {
  return (
    <details data-expand className="mt-1 text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground">Abstract{reason ? " and verdict reason" : ""}</summary>
      {reason ? <p className="mt-1 text-xs">Why: {reason}</p> : null}
      <p className="mt-1 text-muted-foreground">{abstract}</p>
    </details>
  );
}
