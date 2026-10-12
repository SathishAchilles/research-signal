import type { ActionKind, BriefDoc, DomainSelection } from "@/lib/brief/types";
import { CompactRow } from "./CompactRow";
import { HeroCard } from "./HeroCard";
import { StandardCard } from "./StandardCard";

export function DomainSection({ brief, domain, actions }: { brief: BriefDoc; domain: DomainSelection; actions: Record<string, ActionKind> }) {
  const { selection, prose } = brief;
  const intro = prose.domains.find((d) => d.domainId === domain.domainId);
  const cardProse = new Map((intro?.cards ?? []).map((c) => [c.cardId, c]));
  const introText = intro ? [intro.situation, intro.complication, intro.implication].filter(Boolean).join(" ") : "";
  const ids = [domain.hero, ...domain.standard, ...domain.compact].filter((id): id is string => Boolean(id));

  return (
    <section id={domain.slug} aria-labelledby={`${domain.slug}-heading`} className="flex scroll-mt-20 flex-col gap-3">
      <div className="border-b pb-2">
        <h2 id={`${domain.slug}-heading`} className="text-lg font-semibold tracking-tight">
          {domain.name}
        </h2>
        {introText ? <p className="mt-1 text-sm">{introText}</p> : null}
        {domain.quiet ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Quiet week. Nearest miss:{" "}
            {domain.nearestMiss ? `${domain.nearestMiss.title} (score ${domain.nearestMiss.final.toFixed(2)})` : "none"}
          </p>
        ) : null}
      </div>
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
        if (card.tier === "HERO") return <HeroCard key={id} card={card} prose={cardProse.get(id)} action={action} />;
        if (card.tier === "STANDARD") return <StandardCard key={id} card={card} prose={cardProse.get(id)} action={action} />;
        return <CompactRow key={id} card={card} action={action} />;
      })}
    </section>
  );
}
