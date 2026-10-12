import type { ActionKind, BriefDoc } from "@/lib/brief/types";
import { StandardCard } from "./StandardCard";

export function Top3Strip({ brief, actions }: { brief: BriefDoc; actions: Record<string, ActionKind> }) {
  const { selection, prose } = brief;
  if (selection.top3.length === 0) return null;
  const pointers = new Map(prose.top3.map((t) => [t.cardId, t.pointer]));
  const cardProse = new Map(prose.domains.flatMap((d) => d.cards.map((c) => [c.cardId, c] as const)));
  return (
    <section aria-labelledby="top3-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="micro">Top 3 this week</p>
        <h2 id="top3-heading" className="font-heading text-xl font-medium tracking-tight">
          Top 3
        </h2>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {selection.top3.map((id) => {
          const card = selection.cards[id];
          return (
            <StandardCard
              key={id}
              card={card}
              action={actions[card.paperId] ?? null}
              prose={{ ...cardProse.get(id), headline: undefined, pointer: pointers.get(id) }}
            />
          );
        })}
      </div>
    </section>
  );
}
