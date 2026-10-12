import ReadAloud from "@/components/audio/ReadAloud";
import { ConeChart } from "@/components/viz/ConeChart";
import { buildBriefSpeech } from "@/lib/audio/speech";
import { COLORS_UI, VERDICT_ORDER, verdictCounts } from "@/lib/brief/cues";
import { formatCount, formatPercent } from "@/lib/brief/tokens";
import type { BriefCard, BriefDoc } from "@/lib/brief/types";

const CONNECTOR = /\s(?:for|in|of|on|and|with)\s/i;

// Axis alias for a long domain name so it fits two lines under a cone: keep the head phrase before
// a connector ("Computer vision for industrial applications" -> "Computer vision"), and turn a
// three-part hyphenated term into its acronym ("Retrieval-augmented generation" -> "RAG").
function domainAlias(name: string) {
  if (name.length <= 16) return name;
  const head = name.split(CONNECTOR)[0].trim();
  if (head && head.length <= 18) return head;
  const parts = head.split(/[\s-]+/).filter(Boolean);
  return parts.length >= 2 ? parts.map((p) => p[0].toUpperCase()).join("") : head;
}

const TILE_LABEL: Record<BriefCard["verdict"], string> = { CLIENT: "Share with clients", READ: "Read", SKIP: "Skip" };

// Card ids in the order the page renders them with a #card-<id> anchor: Top 3, then each domain
// (Top 3 cards there are only a pointer), then Rising. The first of each verdict is a tile's target.
function anchoredOrder(selection: BriefDoc["selection"]) {
  const ids = [
    ...selection.top3,
    ...selection.domains.flatMap((d) => [d.hero, ...d.standard, ...d.compact]).filter((id) => id && !selection.cards[id]?.inTop3),
    ...selection.rising,
  ];
  return [...new Set(ids)].filter((id): id is string => Boolean(id && selection.cards[id]));
}

// A decision tile: the count is the headline, the label says what it counts, and when there is
// something to see the whole tile is a link that jumps to the first such card on the page.
function DecisionTile({
  label,
  value,
  color,
  href,
  hint,
  tile,
  jump = "jump to the first paper",
}: {
  label: string;
  value: number;
  color: string;
  href: string | null;
  hint?: string;
  tile: string;
  jump?: string;
}) {
  const body = (
    <>
      <span className="font-display text-[32px] leading-none num" style={{ color }}>
        {value}
      </span>
      <span className="micro mt-2 block">{label}</span>
      {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
      {href ? <span className="sr-only">, {jump}</span> : null}
    </>
  );
  const base = "plate relative block min-h-11 rounded-tile border-l-4 p-4 forced-colors:border-l-[CanvasText]";
  if (!href) {
    return (
      <div className={`${base} opacity-70`} style={{ borderLeftColor: color }} data-decision-tile={tile}>
        {body}
      </div>
    );
  }
  return (
    <a
      href={href}
      className={`${base} outline-offset-2 transition-colors hover:bg-plate-hover focus-visible:outline-3 focus-visible:outline-solid focus-visible:outline-focus`}
      style={{ borderLeftColor: color }}
      data-decision-tile={tile}
    >
      {body}
    </a>
  );
}

// The brief's full-width hero: one glass shell holding the week panel (heading, week line, read
// aloud, decision tiles) beside the attention cones. It is the only glass surface in the hero area;
// the figure stage below it sits on the page background so no figure is under a backdrop-filter.
export function WeekHero({ doc, status }: { doc: BriefDoc; status: string }) {
  const { selection, prose } = doc;
  const cards = Object.values(selection.cards);
  const counts = verdictCounts(cards);
  const order = anchoredOrder(selection);
  const firstOf = (verdict: BriefCard["verdict"]) => order.find((id) => selection.cards[id].verdict === verdict);
  const week = Number(selection.isoWeek.slice(6));

  const risingPcts = selection.rising.map((id) => selection.cards[id]?.evidence.rising_pct).filter((v): v is number => v != null);
  const topRising = risingPcts.length ? Math.max(...risingPcts) : null;
  const upvotes = (ids: (string | null)[]) =>
    ids.reduce((sum, id) => sum + (id ? (selection.cards[id]?.evidence.hf_upvotes ?? 0) : 0), 0);
  const cones = [
    ...selection.domains.map((d) => ({
      label: d.name,
      short: domainAlias(d.name),
      value: upvotes([d.hero, ...d.standard, ...d.compact]),
    })),
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
        <nav aria-label="Jump to papers by decision" className="grid grid-cols-2 gap-3">
          {VERDICT_ORDER.map((v) => {
            const first = firstOf(v);
            return (
              <DecisionTile
                key={v}
                tile={v}
                label={TILE_LABEL[v]}
                value={counts[v]}
                color={COLORS_UI.verdict[v]}
                href={counts[v] > 0 && first ? `#card-${first}` : null}
              />
            );
          })}
          <DecisionTile
            tile="RISING"
            label="Rising"
            value={selection.rising.length}
            color={COLORS_UI.rising}
            href={selection.rising.length ? "#rising" : null}
            jump="jump to the Rising section"
            hint={topRising == null ? undefined : `Top UP ${formatPercent(topRising)}`}
          />
        </nav>
      </div>
      {/* Grid rows stretch, so on desktop the plate fills the height of the left column. */}
      <div className="flex min-w-0 flex-col">
        <div className="plate flex flex-1 flex-col gap-3 overflow-hidden p-4 lg:p-5">
          <ConeChart title="Attention this week" unit="HF upvotes" data={cones} />
          <p className="micro mt-auto border-t border-rule/25 pt-3">
            Sources · {degraded === 0 ? "all normal" : `${degraded} degraded`}
          </p>
        </div>
      </div>
    </section>
  );
}
