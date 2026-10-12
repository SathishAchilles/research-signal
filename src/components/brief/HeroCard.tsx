import { PaperFigure } from "@/components/paper/PaperFigure";
import { SpecTable } from "@/components/viz/SpecTable";
import { meterText } from "@/lib/brief/cues";
import { formatCount } from "@/lib/brief/tokens";
import type { ActionKind, BriefCard } from "@/lib/brief/types";
import { AttentionLine, CardFrame, type CardProse, CueRow, MoreDetails } from "./CardParts";

// The paper's lead figure for the specimen card. BriefCard does not carry it, so the brief page passes
// it in (structurally the BriefFigure from briefFigures() in lib/brief/load.ts; venue is optional and
// its row is shown only when given). Absent, the card shows the signal-type glyph in the same box.
export type HeroFigure = {
  url: string | null;
  caption?: string | null;
  authors?: readonly string[];
  venue?: string | null;
};

const count = (n: number | null | undefined) => (n == null ? "—" : formatCount(n));

// HERO tier: a specimen-style spec card (lead figure, spec rows, client angle), after the reference shot.
export function HeroCard({
  card,
  prose,
  action,
  figure,
}: {
  card: BriefCard;
  prose?: CardProse;
  action: ActionKind | null;
  figure?: HeroFigure | null;
}) {
  const e = card.evidence;
  const rows: [string, string][] = [
    ["Evidence", meterText(card.rung)],
    ...(figure?.venue ? ([["Venue", figure.venue]] as [string, string][]) : []),
    ["HF upvotes", count(e.hf_upvotes)],
    ["GitHub stars", count(e.github_stars)],
    ["Models/Spaces", count(e.linked)],
  ];

  return (
    <CardFrame card={card} action={action} className="border-signal/40 p-5 pl-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="micro">Hero{card.arxivId ? ` · arXiv ${card.arxivId}` : ""}</span>
        <span className="micro num">Score {card.final.toFixed(2)}</span>
      </div>
      <h3 className="mt-2 font-heading text-xl leading-snug font-semibold">{prose?.headline || card.title}</h3>
      {prose?.headline ? <p className="mt-0.5 text-sm text-muted-foreground">{card.title}</p> : null}
      <div className="mt-3">
        <CueRow card={card} />
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          {prose?.lede ? <p className="text-[15px] leading-relaxed">{prose.lede}</p> : null}
          <div className="border-t border-rule/60 pt-3">
            <SpecTable rows={rows} />
          </div>
        </div>
        <PaperFigure
          paperId={card.paperId}
          arxivId={card.arxivId}
          figureUrl={figure?.url ?? null}
          caption={figure?.caption}
          authors={figure?.authors ?? []}
          signalType={card.signalType}
          title={card.title}
          width={352}
          height={216}
          sizes="(min-width: 768px) 352px, 100vw"
          className="md:justify-self-end"
        />
      </div>

      <div className="mt-4 rounded-tile bg-plate-hover p-3">
        <p className="micro">Client angle</p>
        <p className="mt-1 text-sm">{prose?.clientAngle || card.clientAngle}</p>
      </div>
      <AttentionLine card={card} />
      <MoreDetails abstract={card.abstract} reason={prose?.verdictReason} />
    </CardFrame>
  );
}
