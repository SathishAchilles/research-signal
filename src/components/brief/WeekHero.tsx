import ReadAloud from "@/components/audio/ReadAloud";
import { ConeChart } from "@/components/viz/ConeChart";
import { StatTile } from "@/components/viz/StatTile";
import { buildBriefSpeech } from "@/lib/audio/speech";
import { formatCount, formatPercent } from "@/lib/brief/tokens";
import type { BriefDoc } from "@/lib/brief/types";

// The brief's full-width hero: one glass shell holding the week panel (heading, week line, read
// aloud, stat tiles) beside the attention cones. It is the only glass surface in the hero area;
// the figure stage below it sits on the page background so no figure is under a backdrop-filter.
export function WeekHero({ doc, status }: { doc: BriefDoc; status: string }) {
  const { selection, prose } = doc;
  const cards = Object.values(selection.cards);
  const week = Number(selection.isoWeek.slice(6));

  const risingPcts = selection.rising.map((id) => selection.cards[id]?.evidence.rising_pct).filter((v): v is number => v != null);
  const topRising = risingPcts.length ? Math.max(...risingPcts) : null;
  const upvotes = (ids: (string | null)[]) =>
    ids.reduce((sum, id) => sum + (id ? (selection.cards[id]?.evidence.hf_upvotes ?? 0) : 0), 0);
  const cones = [
    ...selection.domains.map((d) => ({ label: d.name, value: upvotes([d.hero, ...d.standard, ...d.compact]) })),
    ...(selection.rising.length ? [{ label: "Rising", value: upvotes(selection.rising) }] : []),
  ].map((c) => ({ ...c, display: formatCount(c.value) }));
  const degraded = selection.sourceHealth.length;

  return (
    <section
      aria-label="This week at a glance"
      className="glass-base mt-2 grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8 lg:p-7"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <p className="micro break-words">
          research-signal · {selection.isoWeek} · {status.toLowerCase()} · press ? for shortcuts
        </p>
        <p aria-hidden className="font-display text-[44px] leading-none font-semibold tracking-tight sm:text-[56px] lg:text-[64px]">
          WEEK {week} <span className="text-signal-2">SIGNAL</span>
        </p>
        <h1 className="max-w-[44ch] font-heading text-2xl leading-snug font-medium tracking-tight">{prose.weekLine}</h1>
        {/* Reserved height so the player mounting on the client never shifts the tiles below. */}
        <div className="min-h-10">
          <ReadAloud title={`Research Signal ${selection.isoWeek}`} segments={buildBriefSpeech(doc)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Featured" value={String(cards.length)} />
          <StatTile label="Share with clients" value={String(cards.filter((c) => c.verdict === "CLIENT").length)} />
          <StatTile label="Hero" value={String(selection.domains.filter((d) => d.hero).length)} />
          <StatTile label={topRising == null ? "No risers" : "Top rising"} value={topRising == null ? "—" : `UP ${formatPercent(topRising)}`} />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3 lg:justify-center">
        <div className="plate overflow-hidden p-4 lg:p-5 [&_svg]:mx-auto">
          <ConeChart title="Attention this week" unit="HF upvotes" data={cones} />
        </div>
        <p className="micro">Sources · {degraded === 0 ? "all normal" : `${degraded} degraded`}</p>
      </div>
    </section>
  );
}
