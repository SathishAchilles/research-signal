import Image from "next/image";
import type { ReactNode } from "react";
import { figureAttribution, isServableFigure } from "@/components/paper/PaperFigure";
import { SignalGlyph, signalGlyphLabel } from "@/components/paper/SignalGlyph";
import { COLORS_UI, VERDICT_LABEL, meterText } from "@/lib/brief/cues";
import type { BriefFigure } from "@/lib/brief/load";
import { formatPercent } from "@/lib/brief/tokens";
import type { BriefCard, BriefDoc } from "@/lib/brief/types";
import type { SignalType } from "@/lib/pipeline/rank";
import { HelixParticles } from "./helix/HelixParticles";

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

// A paper figure in a 1px-rim frame on a light mat (paper figures are drawn for white), with a
// subtle inner vignette. The figure itself is never blurred or tinted, and the frame never sits
// under a backdrop-filter. Without a figure the same box shows the signal-type glyph on a plate.
export function FigureFrame({
  figure,
  title,
  fallback,
  width,
  height,
  sizes,
  lead = false,
  className = "",
}: {
  figure: BriefFigure | null | undefined;
  title: string;
  fallback: ReactNode;
  width: number;
  height: number;
  sizes: string;
  lead?: boolean;
  className?: string;
}) {
  const src = isServableFigure(figure?.url) ? figure.url : null;
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-tile border border-plate-rim transition-[border-color,box-shadow] duration-150 ${src ? "bg-[#F3F7F7]" : "bg-plate-solid text-signal/75"} ${className}`}
      style={{ aspectRatio: `${width} / ${height}` }}
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
          className="h-full w-full object-contain p-1.5"
        />
      ) : (
        fallback
      )}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_28px_rgb(4_24_27/.28)]" />
    </div>
  );
}

type StageItem = { id: string; card: BriefCard; rank: number; domainName: string; headline?: string; figure: BriefFigure | null };

const LEAD = { width: 640, height: 480, sizes: "(min-width: 1024px) 680px, 100vw" };
const SIDE = { width: 400, height: 250, sizes: "(min-width: 1024px) 460px, (min-width: 640px) 50vw, 100vw" };

// One stage frame with its Dribbble-style callout: a dot node on the frame rim, a leader line,
// and a plate carrying rank, domain, verdict, rung, signal type and the rising figure. The whole
// item is one link to the card; BriefShell syncs hover and focus with it via data-stage-target.
function StageFrame({ item }: { item: StageItem }) {
  const { card, rank, figure } = item;
  const lead = rank === 1;
  const size = lead ? LEAD : SIDE;
  const rising = card.evidence.rising_pct;
  return (
    <a
      href={`#card-${item.id}`}
      data-stage-target={item.id}
      className="group relative flex flex-col rounded-plate outline-offset-4 focus-visible:outline-3 focus-visible:outline-solid focus-visible:outline-focus"
    >
      <span className="relative block">
        <FigureFrame
          figure={figure}
          title={card.title}
          fallback={<StageGlyph signalType={card.signalType} />}
          lead={lead}
          {...size}
          className="group-hover:border-signal group-data-[linked]:border-signal group-data-[linked]:shadow-[var(--glow-signal)]"
        />
        <span aria-hidden className="micro absolute top-2 left-2 rounded-full border border-plate-rim bg-plate-solid px-2 py-0.5 text-signal num">
          #{rank}
        </span>
        <span
          aria-hidden
          className="absolute -bottom-[5px] left-5 size-2.5 rounded-full bg-signal shadow-[var(--glow-signal)] ring-2 ring-background"
        />
      </span>
      <span aria-hidden className="ml-[24px] h-3 w-px bg-signal/60" />
      <span className="plate ml-3 flex flex-col gap-1 p-3 text-sm transition-[border-color] lg:p-2.5 lg:text-xs duration-150 group-hover:border-signal group-data-[linked]:border-signal">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="micro rounded-full border border-chip-border px-2 py-px">
            #{rank} · {item.domainName}
          </span>
          <span className="font-mono font-bold tracking-[.08em] text-[11px]" style={{ color: COLORS_UI.verdict[card.verdict] }}>
            {VERDICT_LABEL[card.verdict]}
          </span>
        </span>
        <span className={`text-foreground ${lead ? "line-clamp-3 text-[15px] lg:line-clamp-2 lg:text-sm" : "line-clamp-3 lg:line-clamp-2"}`}>{item.headline || card.title}</span>
        <span className="font-mono text-muted-foreground">
          {meterText(card.rung)} · {card.signalType}
          {rising != null && rising > 0 ? (
            <span style={{ color: COLORS_UI.rising }}> · UP {formatPercent(rising)}</span>
          ) : null}
        </span>
        {figure ? (
          <span className="text-xs leading-4 text-muted-foreground lg:text-[11px]">
            {lead && figure.caption ? <span className="line-clamp-1">{figure.caption}</span> : null}
            <span className="block">{figureAttribution(figure.authors, card.arxivId)}</span>
          </span>
        ) : null}
      </span>
    </a>
  );
}

function FigureStage({ items }: { items: StageItem[] }) {
  if (items.length === 0) {
    return <p className="plate p-4 text-sm text-muted-foreground">No Top 3 this week.</p>;
  }
  return (
    <div className="relative isolate">
      <HelixParticles className="-z-10" />
      <ol aria-label="Top 3 figures" className="grid gap-x-5 gap-y-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        {items.map((item) => (
          <li key={item.id} className={item.rank === 1 ? "sm:col-span-2 lg:col-span-1 lg:row-span-2" : ""}>
            <StageFrame item={item} />
          </li>
        ))}
      </ol>
    </div>
  );
}

// The figure stage, full width below the week hero: the top-3 papers' lead figures with their
// callouts. It sits on the page background so no figure is ever under a backdrop-filter.
export function BriefHero({ doc, figures }: { doc: BriefDoc; figures: Record<string, BriefFigure> }) {
  const { selection, prose } = doc;
  const domainName = new Map(selection.domains.map((d) => [d.domainId, d.name]));
  const headlines = new Map(prose.domains.flatMap((d) => d.cards.map((c) => [c.cardId, c.headline] as const)));

  const items: StageItem[] = selection.top3
    .filter((id) => selection.cards[id])
    .map((id, i) => {
      const card = selection.cards[id];
      return {
        id,
        card,
        rank: i + 1,
        domainName: domainName.get(card.domainId) ?? "",
        headline: headlines.get(id),
        figure: isServableFigure(figures[card.paperId]?.url) ? figures[card.paperId] : null,
      };
    });

  return (
    <section aria-labelledby="figure-stage-heading" className="flex flex-col gap-3">
      <h2 id="figure-stage-heading" className="micro">
        Figure stage · top 3 this week
      </h2>
      <FigureStage items={items} />
    </section>
  );
}
