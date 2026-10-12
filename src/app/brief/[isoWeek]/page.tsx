import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BriefHero } from "@/components/brief/BriefHero";
import { BriefShell } from "@/components/brief/BriefShell";
import { DomainChipsBar } from "@/components/brief/DomainChipsBar";
import { DomainSection } from "@/components/brief/DomainSection";
import { SourceHealthFooter } from "@/components/brief/SourceHealthFooter";
import { StandardCard } from "@/components/brief/StandardCard";
import { Top3Strip } from "@/components/brief/Top3Strip";
import { WeekHero } from "@/components/brief/WeekHero";
import { briefFigures, currentActions, loadBrief } from "@/lib/brief/load";

export default function BriefPage({ params }: PageProps<"/brief/[isoWeek]">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pb-12">
      <Suspense fallback={<p className="pt-8 text-sm text-muted-foreground">Loading the brief…</p>}>
        <Brief params={params} />
      </Suspense>
    </main>
  );
}

async function Brief({ params }: Pick<PageProps<"/brief/[isoWeek]">, "params">) {
  const { isoWeek } = await params;
  const stored = /^\d{4}-W\d{2}$/.test(isoWeek) ? await loadBrief(isoWeek) : null;
  if (!stored) notFound();
  const { doc } = stored;
  const { selection, prose } = doc;
  // Figures for the stage (top 3) and the domain banners (each domain's hero).
  const figureIds = [...selection.top3, ...selection.domains.map((d) => d.hero)]
    .filter((id): id is string => Boolean(id && selection.cards[id]))
    .map((id) => selection.cards[id].paperId);
  const [actions, figures] = await Promise.all([
    currentActions([...new Set(Object.values(selection.cards).map((c) => c.paperId))]),
    briefFigures([...new Set(figureIds)]),
  ]);
  const risingLines = new Map(prose.rising.map((r) => [r.cardId, r.line]));

  return (
    <BriefShell>
      <WeekHero doc={doc} status={stored.status} />
      <BriefHero doc={doc} figures={figures} />
      <DomainChipsBar selection={selection} />
      <Top3Strip brief={doc} actions={actions} />
      {selection.domains.map((domain) => (
        <DomainSection key={domain.slug} brief={doc} domain={domain} actions={actions} figures={figures} />
      ))}
      {selection.rising.length > 0 ? (
        <section id="rising" aria-labelledby="rising-heading" className="flex scroll-mt-32 flex-col gap-3">
          <h2 id="rising-heading" className="border-t border-rule pt-4 font-heading text-xl font-medium tracking-tight text-rising">
            Rising
          </h2>
          {selection.rising.map((id) => (
            <StandardCard key={id} card={selection.cards[id]} action={actions[selection.cards[id].paperId] ?? null} prose={{ line: risingLines.get(id) }} />
          ))}
        </section>
      ) : null}
      <SourceHealthFooter selection={selection} proseSource={doc.proseSource} />
    </BriefShell>
  );
}
