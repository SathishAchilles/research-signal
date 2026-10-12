import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { figureAttribution, isServableFigure } from "@/components/paper/PaperFigure";
import { SignalGlyph, signalGlyphLabel } from "@/components/paper/SignalGlyph";
import { COLORS_UI } from "@/lib/brief/cues";
import { isRealFigure } from "@/lib/brief/figures";
import type { BriefFigure } from "@/lib/brief/load";
import { formatPercent } from "@/lib/brief/tokens";
import type { ActionKind, BriefCard, BriefDoc } from "@/lib/brief/types";
import type { SignalType } from "@/lib/pipeline/rank";
import { cn } from "@/lib/utils";
import { AttentionLine, CardFrame, type CardProse, CueRow, MoreDetails } from "./CardParts";
import { HelixParticles } from "./helix/HelixParticles";
import { CARD_TOUCH } from "./StandardCard";

function GlyphBox({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-full items-center justify-center bg-[linear-gradient(rgb(127_224_230/.05)_1px,transparent_1px),linear-gradient(90deg,rgb(127_224_230/.05)_1px,transparent_1px)] bg-size-[12px_12px]">
      {children}
    </span>
  );
}

export function StageGlyph({ signalType }: { signalType: SignalType }) {
  return (
    <GlyphBox>
      <SignalGlyph signalType={signalType} size="38%" label={signalGlyphLabel(signalType)} />
    </GlyphBox>
  );
}

// A flat trace with one small blip: the domain had no paper above the bar this week.
export function QuietDomainGlyph({ name }: { name: string }) {
  return (
    <GlyphBox>
      <svg
        viewBox="0 0 48 48"
        width="38%"
        height="38%"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        role="img"
        aria-label={`${name}: quiet week, no lead figure`}
      >
        <path d="M4 28h13l3-6 3 11 3-5h18" />
        <path d="M4 38h40" strokeDasharray="1 4" opacity={0.5} />
      </svg>
    </GlyphBox>
  );
}

// The figure for a stage, banner or hero visual: servable by next/image and an actual figure from
// the paper (not the rendered title page). Anything else gets the signal-type glyph.
export function displayFigure(figure: BriefFigure | null | undefined): BriefFigure | null {
  return figure && isServableFigure(figure.url) && isRealFigure(figure.source) ? figure : null;
}

const FIT_CLASS = {
  width: "min-w-full",
  height: "min-h-full",
  lead: "min-w-full sm:min-w-0 sm:min-h-full",
} as const;

// A paper figure in a 1px-rim frame. The light mat (paper figures are drawn for white) hugs the
// figure itself: the image keeps its own aspect inside the box (object-contain) and carries the
// mat as a thin padding, so any letterbox is the dark plate, not an empty light mat. The figure
// is never blurred or tinted, and the frame never sits under a backdrop-filter. Without a figure
// the same box shows the signal-type glyph on a plate.
export function FigureFrame({
  figure,
  title,
  fallback,
  width,
  height,
  sizes,
  lead = false,
  fit = "width",
  aspectClass,
  className = "",
}: {
  figure: BriefFigure | null | undefined;
  title: string;
  fallback: ReactNode;
  width: number;
  height: number;
  sizes: string;
  lead?: boolean;
  /**
   * The axis the figure fills: "height" for very wide boxes (most figures are narrower than 7:3),
   * "width" for 16:9 boxes (most figures are wider). It keeps its own aspect either way; only a
   * figure that overflows the other axis is letterboxed inside its mat. "lead" is "width" on
   * phones (16:9 box) and "height" from sm up (7:3 box).
   */
  fit?: keyof typeof FIT_CLASS;
  /** Responsive aspect-ratio classes; replaces the width / height ratio when given. */
  aspectClass?: string;
  className?: string;
}) {
  const src = isServableFigure(figure?.url) ? figure.url : null;
  return (
    <div
      data-figure={src ? "image" : "glyph"}
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-tile border border-plate-rim bg-plate-solid transition-[border-color,box-shadow] duration-150",
        !src && "text-signal/75",
        aspectClass,
        className,
      )}
      style={aspectClass ? undefined : { aspectRatio: `${width} / ${height}` }}
    >
      {src ? (
        <Image
          src={src}
          alt={`Figure from ${title}`}
          width={width}
          height={height}
          sizes={sizes}
          preload={lead}
          fetchPriority={lead ? "high" : undefined}
          loading={lead ? undefined : "lazy"}
          className={cn(
            "block h-auto max-h-full w-auto max-w-full rounded-[5px] bg-[#F3F7F7] object-contain p-1",
            FIT_CLASS[fit],
          )}
        />
      ) : (
        fallback
      )}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_28px_rgb(4_24_27/.28)]" />
    </div>
  );
}

type StageItem = {
  id: string;
  card: BriefCard;
  rank: number;
  domainName: string;
  prose: CardProse;
  figure: BriefFigure | null;
  action: ActionKind | null;
};

// The lead spans both columns at about 1120x480 (16:9 on phones); #2 and #3 sit side by side at 16:9.
const LEAD = {
  width: 1120,
  height: 480,
  fit: "lead" as const,
  aspectClass: "aspect-video sm:aspect-[1120/480]",
  sizes: "(min-width: 1152px) 1120px, calc(100vw - 32px)",
};
const SIDE = {
  width: 640,
  height: 360,
  fit: "width" as const,
  aspectClass: "aspect-video",
  sizes: "(min-width: 1152px) 560px, (min-width: 640px) calc(50vw - 28px), calc(100vw - 32px)",
};

// One Top 3 card: the paper's lead figure on top, then the actionable card (title link to the paper,
// verdict, rung, signal, pointer, client angle, Read / Share / Skip). It is a [data-card] like every
// other card, so j/k/r/c/s and Enter work on it, and the domain lists' "In Top 3" links land here.
function StageCard({ item, wide }: { item: StageItem; wide: boolean }) {
  const { card, rank, figure, prose } = item;
  const lead = rank === 1;
  const size = lead || wide ? LEAD : SIDE;
  const rising = card.evidence.rising_pct;
  return (
    <CardFrame card={card} action={item.action} className={cn("flex h-full flex-col", CARD_TOUCH)}>
      <div className="relative">
        <FigureFrame
          figure={figure}
          title={card.title}
          fallback={<StageGlyph signalType={card.signalType} />}
          lead={lead}
          {...size}
        />
        <span aria-hidden className="micro absolute top-2 left-2 rounded-full border border-plate-rim bg-plate-solid px-2 py-0.5 text-signal num">
          #{rank}
        </span>
      </div>
      <div className={cn("mt-3 flex flex-1 flex-col gap-1", lead && "lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-x-6")}>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="micro rounded-full border border-chip-border px-2 py-px">
              #{rank} · {item.domainName}
            </span>
            <CueRow card={card} />
            {card.tier !== "RISING" && rising != null && rising > 0 ? (
              <span className="font-mono text-xs font-medium" style={{ color: COLORS_UI.rising }}>
                UP {formatPercent(rising)}
              </span>
            ) : null}
          </div>
          <h3 className={cn("font-heading leading-snug font-semibold", lead ? "text-xl" : "text-base")}>
            <Link href={`/paper/${card.paperId}`} className="underline-offset-2 hover:text-signal hover:underline">
              {prose.headline || card.title}
            </Link>
          </h3>
          {prose.headline ? <p className="text-sm text-muted-foreground lg:text-xs">{card.title}</p> : null}
          {prose.pointer ? <p className="text-sm">{prose.pointer}</p> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm">
            <span className="font-semibold">Client angle:</span> {prose.clientAngle || card.clientAngle}
          </p>
          {figure ? (
            <p className="text-xs leading-4 text-muted-foreground">
              {lead && figure.caption ? <span className="line-clamp-1">{figure.caption}</span> : null}
              <span className="block">{figureAttribution(figure.authors, card.arxivId)}</span>
            </p>
          ) : null}
          <AttentionLine card={card} />
          <MoreDetails abstract={card.abstract} reason={prose.verdictReason} />
        </div>
      </div>
    </CardFrame>
  );
}

function FigureStage({ items }: { items: StageItem[] }) {
  if (items.length === 0) {
    return <p className="plate p-4 text-sm text-muted-foreground">No Top 3 this week.</p>;
  }
  // With only two items the second spans both columns too, so no column is ever left empty.
  const wide = items.length === 2;
  return (
    <div className="relative isolate">
      <HelixParticles className="-z-10" />
      <ol aria-label="Top 3 this week" className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.id} className={item.rank === 1 || wide ? "sm:col-span-2" : ""}>
            <StageCard item={item} wide={wide} />
          </li>
        ))}
      </ol>
    </div>
  );
}

// The Top 3, shown once, full width below the week hero: each paper's lead figure on its actionable
// card. It sits on the page background so no figure is ever under a backdrop-filter.
export function BriefHero({
  doc,
  figures,
  actions = {},
}: {
  doc: BriefDoc;
  figures: Record<string, BriefFigure>;
  actions?: Record<string, ActionKind>;
}) {
  const { selection, prose } = doc;
  const domainName = new Map(selection.domains.map((d) => [d.domainId, d.name]));
  const cardProse = new Map(prose.domains.flatMap((d) => d.cards.map((c) => [c.cardId, c] as const)));
  const pointers = new Map(prose.top3.map((t) => [t.cardId, t.pointer]));

  const items: StageItem[] = selection.top3
    .filter((id) => selection.cards[id])
    .map((id, i) => {
      const card = selection.cards[id];
      return {
        id,
        card,
        rank: i + 1,
        domainName: domainName.get(card.domainId) ?? "",
        prose: { ...cardProse.get(id), pointer: pointers.get(id) },
        figure: displayFigure(figures[card.paperId]),
        action: actions[card.paperId] ?? null,
      };
    });

  return (
    <section aria-labelledby="top3-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="micro">Figure stage · this week</p>
        <h2 id="top3-heading" className="font-heading text-xl font-medium tracking-tight">
          Top 3
        </h2>
      </div>
      <FigureStage items={items} />
    </section>
  );
}
