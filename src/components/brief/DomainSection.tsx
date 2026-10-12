import { SpecTable } from "@/components/viz/SpecTable";
import type { BriefFigure } from "@/lib/brief/load";
import type { ActionKind, BriefDoc, DomainSelection } from "@/lib/brief/types";
import { figureAttribution, isServableFigure } from "@/components/paper/PaperFigure";
import { FigureFrame, QuietDomainGlyph, StageGlyph } from "./BriefHero";
import { CompactRow } from "./CompactRow";
import { HeroCard } from "./HeroCard";
import { StandardCard } from "./StandardCard";

// The header banner: the domain's HERO-paper figure, its signal glyph when it has none, or a
// quiet-trace glyph when the domain has no hero this week.
function DomainBanner({ brief, domain, figures }: { brief: BriefDoc; domain: DomainSelection; figures: Record<string, BriefFigure> }) {
  const hero = domain.hero ? brief.selection.cards[domain.hero] : undefined;
  const raw = hero ? figures[hero.paperId] : undefined;
  const figure = raw && isServableFigure(raw.url) ? raw : null;
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
      <figcaption className="text-[11px] leading-4 text-muted-foreground">
        {hero ? (
          <>
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
  const spec: [string, string][] = [
    ["Papers", String((domain.hero ? 1 : 0) + domain.standard.length + domain.compact.length)],
    ["Hero", domain.hero ? "1" : "0"],
    ["Quiet", domain.quiet ? "yes" : "no"],
    ...(domain.quiet && domain.nearestMiss ? [["Nearest miss", domain.nearestMiss.final.toFixed(2)] as [string, string]] : []),
  ];

  return (
    <section id={domain.slug} aria-labelledby={`${domain.slug}-heading`} className="flex scroll-mt-32 flex-col gap-3">
      <h2 id={`${domain.slug}-heading`} className="border-t border-rule pt-4 font-heading text-xl font-medium tracking-tight">
        {domain.name}
      </h2>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-x-6">
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
          className="plate grid grid-cols-[9rem_minmax(0,1fr)] items-start gap-4 self-start p-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:grid-cols-1"
        >
          <DomainBanner brief={brief} domain={domain} figures={figures} />
          <SpecTable rows={spec} />
        </aside>
        <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-2">
          {ids.map((id) => {
            const card = selection.cards[id];
            const action = actions[card.paperId] ?? null;
            if (card.inTop3) {
              return (
                <p key={id} className="text-sm text-muted-foreground">
                  In Top 3:{" "}
                  <a href={`#card-${id}`} className="underline">
                    {card.title}
                  </a>
                </p>
              );
            }
            if (card.tier === "HERO") return <HeroCard key={id} card={card} prose={cardProse.get(id)} action={action} figure={figures[card.paperId]} />;
            if (card.tier === "STANDARD") return <StandardCard key={id} card={card} prose={cardProse.get(id)} action={action} />;
            return <CompactRow key={id} card={card} action={action} />;
          })}
        </div>
      </div>
    </section>
  );
}
