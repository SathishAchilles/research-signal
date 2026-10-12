import { COLORS_UI, meterText, VERDICT_LABEL } from "@/lib/brief/cues";
import { formatPercent } from "@/lib/brief/tokens";
import type { BriefDoc } from "@/lib/brief/types";
import type { Rung, SignalType, Verdict } from "@/lib/pipeline/rank";
import { HelixParticles } from "./HelixParticles";

// One top-3 paper pinned to the helix. Built from BriefDoc fields only (see helixTop3).
export type HelixItem = {
  cardId: string;
  rank: number;
  domainName: string;
  verdict: Verdict;
  title: string;
  headline?: string;
  rung: Rung;
  signalType: SignalType;
  rising: string | null;
};

// Geometry in viewBox units (600 x 420). The particle layer gets the same numbers as props.
const W = 600;
const H = 420;
const CX = 170;
const AMP = 70;
const PERIOD = 210;
const Y0 = 24;
const Y1 = 396;
const LEADER_X = 300;
const CALLOUT_GAP = 64;
const CALLOUT_MIN_Y = 40;
const CALLOUT_MAX_Y = 380;
const BANDS: [Rung, number, number][] = [
  ["PEER", 40, 120],
  ["MODEL", 120, 200],
  ["CODE", 200, 280],
  ["LAB", 280, 360],
];
const BAND_CENTER = Object.fromEntries(BANDS.map(([r, a, b]) => [r, (a + b) / 2])) as Record<Rung, number>;

const r1 = (n: number) => Math.round(n * 10) / 10;
const strandX = (y: number, phase: number) => CX + AMP * Math.sin((2 * Math.PI * y) / PERIOD + phase);

function strandPath(phase: number): string {
  const pts: string[] = [];
  for (let y = Y0; y <= Y1; y += 5) pts.push(`${r1(strandX(y, phase))} ${y}`);
  return `M${pts.join("L")}`;
}

const PATH_A = strandPath(0);
const PATH_B = strandPath(Math.PI);
const PAIRS: number[] = [];
for (let y = Y0 + 4; y <= Y1 - 4; y += 14) PAIRS.push(y);

// Top-3 cards in rank order, with the domain name, the prose headline and the rising text resolved.
export function helixTop3(doc: BriefDoc): HelixItem[] {
  const { selection, prose } = doc;
  const domains = new Map(selection.domains.map((d) => [d.domainId, d.name]));
  const headlines = new Map(prose.domains.flatMap((d) => d.cards.map((c) => [c.cardId, c.headline] as const)));
  return selection.top3.flatMap((id, i) => {
    const card = selection.cards[id];
    if (!card) return [];
    const pct = card.evidence.rising_pct;
    return [
      {
        cardId: id,
        rank: i + 1,
        domainName: domains.get(card.domainId) ?? "",
        verdict: card.verdict,
        title: card.title,
        headline: headlines.get(id),
        rung: card.rung,
        signalType: card.signalType,
        rising: card.tier === "RISING" && pct != null ? formatPercent(pct) : null,
      },
    ];
  });
}

type Placed = HelixItem & { nx: number; ny: number; cy: number };

// Node at its rung band (stacked 18 apart within a rung); callouts pushed apart by 64, then kept in the box.
function place(items: HelixItem[]): Placed[] {
  const seen: Partial<Record<Rung, number>> = {};
  const placed = items.map((it) => {
    const k = seen[it.rung] ?? 0;
    seen[it.rung] = k + 1;
    const ny = BAND_CENTER[it.rung] + k * 18;
    return { ...it, nx: strandX(ny, 0), ny, cy: ny };
  });
  const byY = [...placed].sort((a, b) => a.ny - b.ny || a.rank - b.rank);
  byY.forEach((p, i) => {
    if (i > 0) p.cy = Math.max(p.ny, byY[i - 1].cy + CALLOUT_GAP);
  });
  const last = byY.at(-1);
  if (last && last.cy > CALLOUT_MAX_Y) {
    const shift = Math.min(last.cy - CALLOUT_MAX_Y, byY[0].cy - CALLOUT_MIN_Y);
    byY.forEach((p) => (p.cy -= shift));
  }
  return placed;
}

const NODE_GLOW =
  "[filter:drop-shadow(0_0_6px_rgb(63_224_208/.6))] [@media(prefers-reduced-transparency:reduce)]:[filter:none] [:root[data-glass=off]_&]:[filter:none] contrast-more:[filter:none]";

export function SignalHelix({ top3, particles = true, dim = false }: { top3: HelixItem[]; particles?: boolean; dim?: boolean }) {
  const placed = place(top3);
  return (
    <div className={`relative w-full ${dim ? "opacity-35" : ""}`}>
      <div className="relative aspect-[600/420] w-full">
        <svg aria-hidden focusable="false" viewBox={`0 0 ${W} ${H}`} className="block h-full w-full">
          {BANDS.map(([rung, a, b]) => (
            <text key={rung} x={8} y={(a + b) / 2} dominantBaseline="middle" className="micro fill-muted-foreground">
              {rung}
            </text>
          ))}
          <g className="stroke-rule/35" strokeWidth={1}>
            {PAIRS.map((y) => (
              <line key={y} x1={r1(strandX(y, 0))} y1={y} x2={r1(strandX(y, Math.PI))} y2={y} />
            ))}
          </g>
          <g fill="none" strokeDasharray="0 7" strokeLinecap="round" strokeWidth={3}>
            <path d={PATH_A} className="stroke-signal" />
            <path d={PATH_B} className="stroke-signal-2" />
          </g>
          {placed.length ? (
            <>
              <g className="hidden stroke-signal/60 lg:inline" strokeWidth={1}>
                {placed.map((p) => (
                  <line key={p.cardId} x1={r1(p.nx)} y1={p.ny} x2={LEADER_X} y2={p.cy} />
                ))}
              </g>
              <g className={`fill-signal ${NODE_GLOW}`}>
                {placed.map((p) => (
                  <circle key={p.cardId} cx={r1(p.nx)} cy={p.ny} r={6} />
                ))}
              </g>
            </>
          ) : null}
        </svg>
        {particles ? <HelixParticles cx={CX} amp={AMP} period={PERIOD} y0={Y0} y1={Y1} w={W} /> : null}
      </div>
      {placed.length ? (
        <ol aria-label="Top 3 on the evidence ladder" className="mt-3 flex flex-col gap-2 lg:absolute lg:inset-0 lg:mt-0 lg:block">
          {placed.map((p) => (
            <li
              key={p.cardId}
              style={{ top: `${(p.cy / H) * 100}%`, left: "50%" }}
              className="lg:absolute lg:w-[46%] lg:-translate-y-1/2"
            >
              <a
                href={`#card-${p.cardId}`}
                data-helix-target={p.cardId}
                className="plate glass-interactive block p-2.5 text-xs data-[linked]:border-signal"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="micro min-w-0 truncate">
                    #{p.rank} · {p.domainName}
                  </span>
                  <span style={{ color: COLORS_UI.verdict[p.verdict] }} className="shrink-0 font-mono font-bold">
                    {VERDICT_LABEL[p.verdict]}
                  </span>
                </span>
                <span className="line-clamp-1 text-foreground">{p.headline ?? p.title}</span>
                <span className="block truncate font-mono text-muted-foreground">
                  {meterText(p.rung)} · {p.signalType}
                  {p.rising ? ` · UP ${p.rising}` : ""}
                </span>
              </a>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
