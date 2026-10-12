import type { ReactNode } from "react";
import { SpecTable } from "@/components/viz/SpecTable";
import { COLORS_UI, VERDICT_ORDER, verdictCounts } from "@/lib/brief/cues";
import type { BriefFigure } from "@/lib/brief/load";
import type { ActionKind, BriefDoc, DomainSelection } from "@/lib/brief/types";
import { figureAttribution } from "@/components/paper/PaperFigure";
import { displayFigure, FigureFrame, QuietDomainGlyph, StageGlyph } from "./BriefHero";
import { CompactRow } from "./CompactRow";
import { HeroCard } from "./HeroCard";
import { StandardCard } from "./StandardCard";

// The header banner: the domain's HERO-paper figure, its signal glyph when it has no real figure, or
// a quiet-trace glyph when the domain has no hero this week. A hero that is in the Top 3 already shows
// its figure on the figure stage, so the banner shows the glyph and points there instead.
function DomainBanner({ brief, domain, figures }: { brief: BriefDoc; domain: DomainSelection; figures: Record<string, BriefFigure> }) {
  const heroId = domain.hero ?? undefined;
  const hero = heroId ? brief.selection.cards[heroId] : undefined;
  const topRank = heroId && hero?.inTop3 ? brief.selection.top3.indexOf(heroId) + 1 : 0;
  const figure = hero && !topRank ? displayFigure(figures[hero.paperId]) : null;
  return (
    <figure className="flex flex-col gap-1">
      <FigureFrame
        figure={figure}
        title={hero?.title ?? domain.name}
        fallback={hero ? <StageGlyph signalType={hero.signalType} /> : <QuietDomainGlyph name={domain.name} />}
        width={480}
        height={270}
        sizes="(min-width: 1024px) 240px, 160px"
      />
      <figcaption className="text-xs leading-4 text-muted-foreground lg:text-[11px]">
        {hero ? (
          <>
            {topRank > 0 ? <span className="micro block text-signal">In Top 3 · #{topRank}</span> : null}
            <span className="line-clamp-1">{hero.title}</span>
            {figure ? <span className="block">{figureAttribution(figure.authors, hero.arxivId)}</span> : null}
          </>
        ) : (
          "Quiet week"
        )}
      </figcaption>
    </figure>
  );
}

const VERDICT_SPEC_LABEL = { CLIENT: "Share with clients", READ: "Read", SKIP: "Skip" } as const;

export function DomainSection({
  brief,
  domain,
  actions,
  figures = {},
}: {
  brief: BriefDoc;
  domain: DomainSelection;
  actions: Record<string, ActionKind>;
  figures?: Record<string, BriefFigure>;
}) {
  const { selection, prose } = brief;
  const intro = prose.domains.find((d) => d.domainId === domain.domainId);
  const cardProse = new Map((intro?.cards ?? []).map((c) => [c.cardId, c]));
  const introText = intro ? [intro.situation, intro.complication, intro.implication].filter(Boolean).join(" ") : "";
  const ids = [domain.hero, ...domain.standard, ...domain.compact].filter((id): id is string => Boolean(id));
  // Decision split for this domain: the same verdict words and colors as the cards and the hero tiles.
  const split = verdictCounts(ids.map((id) => selection.cards[id]).filter(Boolean));
  const spec: [string, ReactNode][] = [
    ["Papers", String(ids.length)],
    ...VERDICT_ORDER.map((v): [string, ReactNode] => [
      VERDICT_SPEC_LABEL[v],
      <span key={v} style={{ color: COLORS_UI.verdict[v] }} data-verdict={v}>
        {split[v]}
      </span>,
    ]),
    ["Quiet", domain.quiet ? "yes" : "no"],
    ...(domain.quiet && domain.nearestMiss ? [["Nearest miss", domain.nearestMiss.final.toFixed(2)] as [string, string]] : []),
  ];

  return (
    <section id={domain.slug} aria-labelledby={`${domain.slug}-heading`} className="flex scroll-mt-36 flex-col gap-3">
      <h2 id={`${domain.slug}-heading`} className="border-t border-rule pt-4 font-heading text-xl font-medium tracking-tight">
        {domain.name}
      </h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-x-6">
        <div className="lg:col-start-1 lg:row-start-1">
          {introText ? <p className="max-w-prose text-base leading-[26px]">{introText}</p> : null}
          {domain.quiet ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Quiet week. Nearest miss:{" "}
              {domain.nearestMiss ? `${domain.nearestMiss.title} (score ${domain.nearestMiss.final.toFixed(2)})` : "none"}
            </p>
          ) : null}
        </div>
        <aside
          aria-label={`${domain.name} at a glance`}
          className="plate grid grid-cols-[9rem_minmax(0,1fr)] items-start gap-4 self-start p-3 lg:sticky lg:top-36 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:grid-cols-1"
        >
          <DomainBanner brief={brief} domain={domain} figures={figures} />
          <SpecTable rows={spec} />
        </aside>
        <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-2">
          {ids.map((id) => {
            const card = selection.cards[id];
            const action = actions[card.paperId] ?? null;
            if (card.inTop3) {
              // A text marker only: the card itself (and its figure) is on the figure stage above.
              const rank = selection.top3.indexOf(id) + 1;
              return (
                <p key={id} className="text-sm text-muted-foreground">
                  In Top 3{rank > 0 ? ` (#${rank})` : ""}:{" "}
                  <a href={`#card-${id}`} data-stage-target={id} className="underline touch:inline-flex touch:min-h-11 touch:items-center">
                    {card.title}
                  </a>
                </p>
              );
            }
            if (card.tier === "HERO") return <HeroCard key={id} card={card} prose={cardProse.get(id)} action={action} figure={displayFigure(figures[card.paperId])} />;
            if (card.tier === "STANDARD") return <StandardCard key={id} card={card} prose={cardProse.get(id)} action={action} />;
            return <CompactRow key={id} card={card} action={action} />;
          })}
        </div>
      </div>
    </section>
  );
}
