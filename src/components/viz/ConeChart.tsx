import type { CSSProperties } from "react";
import { useId } from "react";

import { formatCount } from "@/lib/brief/tokens";

// `short` is an optional axis alias; the full `label` stays in the tooltip and the sr-only table.
type Datum = { label: string; value: number; display: string; short?: string };

const GRID_STEPS = 3; // baseline plus three faint gridlines
const CONE_WIDTH = 0.84; // share of a slot the cone base covers
const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

// Round max/3 up to the next readable step (NICE x 10^k): the top gridline hugs the max and every
// gridline lands on a readable value.
function niceStep(max: number) {
  const raw = max / GRID_STEPS;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = NICE.find((n) => norm <= n + 1e-9) ?? 10;
  return nice * mag;
}

// Tick labels: compact counts for whole steps, fixed decimals for sub-unit steps (USD cost charts).
function formatTick(value: number, step: number) {
  if (value === 0) return "0";
  if (step >= 1 && Number.isInteger(step)) return formatCount(value);
  let decimals = Math.max(0, -Math.floor(Math.log10(step)));
  if (!Number.isInteger(Math.round(step * 10 ** decimals * 1e6) / 1e6)) decimals += 1;
  return value.toFixed(decimals);
}

// Shapes live in a stretched 100x100 SVG (non-scaling strokes); every piece of text is HTML laid out
// in percentages on top of it, so the chart fills any plate size with no measurement, no client JS
// and no layout shift, and category labels wrap instead of truncating.
export function ConeChart({
  title,
  unit,
  data,
}: {
  title: string;
  unit: string;
  data: Datum[];
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const fillId = `cone-fill-${id}`;
  const sheenId = `cone-sheen-${id}`;
  const max = Math.max(0, ...data.map((d) => d.value));

  if (!(max > 0)) {
    return (
      <figure>
        <figcaption className="micro mb-2">{title}</figcaption>
        <p className="text-sm text-muted-foreground">No data yet.</p>
      </figure>
    );
  }

  const step = niceStep(max);
  const top = step * GRID_STEPS;
  const ticks = Array.from({ length: GRID_STEPS + 1 }, (_, k) => k * step);
  const n = data.length;
  const slot = 100 / n;
  const half = (slot * CONE_WIDTH) / 2;
  const pct = (v: number) => (Math.max(0, v) / top) * 100;
  const columns: CSSProperties = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };

  return (
    <figure className="flex h-full min-w-0 flex-1 flex-col">
      <figcaption className="micro mb-3">
        {title} · {unit}
      </figcaption>
      <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col">
        <div className="grid min-h-[220px] flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-2">
          {/* Tick values: pt-5 matches the plot so 100% lines up with the top gridline. */}
          <div className="relative min-w-[3ch] pt-5">
            <div className="relative h-full">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="num absolute right-0 translate-y-1/2 font-mono text-[10px] leading-none text-muted-foreground"
                  style={{ bottom: `${pct(t)}%` }}
                >
                  {formatTick(t, step)}
                </span>
              ))}
              {/* Invisible widest tick keeps the gutter wide enough for the absolute labels. */}
              <span className="invisible block h-0 font-mono text-[10px]">{formatTick(top, step)}</span>
            </div>
          </div>
          <div className="relative min-w-0 pt-5">
            <div className="relative h-full">
              <svg
                focusable="false"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full overflow-visible"
              >
                <defs>
                  <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" style={{ stopColor: "var(--signal)", stopOpacity: 0.85 }} />
                    <stop offset="0.55" style={{ stopColor: "var(--signal-2)", stopOpacity: 0.32 }} />
                    <stop offset="1" style={{ stopColor: "var(--signal-2)", stopOpacity: 0.04 }} />
                  </linearGradient>
                  <linearGradient id={sheenId} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" style={{ stopColor: "var(--text)", stopOpacity: 0 }} />
                    <stop offset="1" style={{ stopColor: "var(--text)", stopOpacity: 0.14 }} />
                  </linearGradient>
                </defs>
                {ticks.slice(1).map((t) => (
                  <line
                    key={t}
                    x1={0}
                    x2={100}
                    y1={100 - pct(t)}
                    y2={100 - pct(t)}
                    style={{ stroke: "var(--rule)", strokeOpacity: 0.22 }}
                    strokeWidth={1}
                    strokeDasharray="2 4"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {data.map((d, i) => {
                  const cx = slot * i + slot / 2;
                  const apexY = 100 - pct(d.value);
                  if (!(d.value > 0)) return null;
                  return (
                    <g key={`${d.label}-${i}`}>
                      <polygon
                        points={`${cx - half},100 ${cx},${apexY} ${cx + half},100`}
                        fill={`url(#${fillId})`}
                        style={{ stroke: "var(--signal)", strokeOpacity: 0.85 }}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                        strokeLinejoin="round"
                      />
                      {/* Lit left face: a soft sheen that reads as a glossy cone rather than a flat wedge. */}
                      <polygon points={`${cx - half},100 ${cx},${apexY} ${cx},100`} fill={`url(#${sheenId})`} />
                    </g>
                  );
                })}
                <line
                  x1={0}
                  x2={100}
                  y1={100}
                  y2={100}
                  style={{ stroke: "var(--rule)" }}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {data.map((d, i) => (
                <span
                  key={`${d.label}-${i}`}
                  className="num absolute -translate-x-1/2 pb-1 font-mono text-[11px] leading-none whitespace-nowrap text-foreground"
                  style={{ left: `${((i + 0.5) / n) * 100}%`, bottom: `${pct(d.value)}%` }}
                >
                  {d.display}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
          <span className="invisible block h-0 min-w-[3ch] font-mono text-[10px]">{formatTick(top, step)}</span>
          <div className="grid gap-x-1" style={columns}>
            {data.map((d, i) => (
              <span
                key={`${d.label}-${i}`}
                title={d.label}
                className="text-center font-mono text-[10px] leading-tight hyphens-auto text-muted-foreground break-words sm:text-[11px]"
              >
                {/* Zero-width break after "_" so snake_case stage names wrap at the joint, not mid-word. */}
                {(d.short ?? d.label).replace(/_/g, "_\u200b")}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">label</th>
              <th scope="col">value ({unit})</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={`${d.label}-${i}`}>
                <td>{d.label}</td>
                <td>{d.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
