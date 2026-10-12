import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BriefShell } from "@/components/brief/BriefShell";
import { DomainChipsBar } from "@/components/brief/DomainChipsBar";
import { DomainSection } from "@/components/brief/DomainSection";
import { SourceHealthFooter } from "@/components/brief/SourceHealthFooter";
import { StandardCard } from "@/components/brief/StandardCard";
import { Top3Strip } from "@/components/brief/Top3Strip";
import { currentActions, loadBrief } from "@/lib/brief/load";

export default function BriefPage({ params }: PageProps<"/brief/[isoWeek]">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 pb-12">
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
  const actions = await currentActions([...new Set(Object.values(selection.cards).map((c) => c.paperId))]);
  const risingLines = new Map(prose.rising.map((r) => [r.cardId, r.line]));

  return (
    <BriefShell>
      <DomainChipsBar selection={selection} />
      <header className="flex flex-col gap-1 pt-2">
        <p className="text-xs text-muted-foreground">
          research-signal · {selection.isoWeek} · {stored.status.toLowerCase()} · press ? for shortcuts
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{prose.weekLine}</h1>
      </header>
      <Top3Strip brief={doc} actions={actions} />
      {selection.domains.map((domain) => (
        <DomainSection key={domain.slug} brief={doc} domain={domain} actions={actions} />
      ))}
      {selection.rising.length > 0 ? (
        <section id="rising" aria-labelledby="rising-heading" className="flex scroll-mt-20 flex-col gap-3">
          <h2 id="rising-heading" className="border-b pb-2 text-lg font-semibold tracking-tight text-[#007A5E]">
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
