import { useId } from "react";

type Datum = { label: string; value: number; display: string };

const H = 160;
const SLOT = 72; // fits a 10ch label at 11px mono
const TOP = 20; // room for the value label above a full-height cone
const BASE = H - 26; // baseline y; category labels sit below it
const MONO = "var(--font-jetbrains-mono), ui-monospace, monospace";

function shortLabel(label: string) {
  return label.length > 10 ? `${label.slice(0, 9)}…` : label;
}

export function ConeChart({
  title,
  unit,
  data,
}: {
  title: string;
  unit: string;
  data: Datum[];
}) {
  const gradientId = `cone-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const max = Math.max(0, ...data.map((d) => d.value));

  if (!(max > 0)) {
    return (
      <figure>
        <figcaption className="micro mb-2">{title}</figcaption>
        <p className="text-sm text-muted-foreground">No data yet.</p>
      </figure>
    );
  }

  const W = SLOT * data.length;
  const span = BASE - TOP;

  return (
    <figure>
      <figcaption className="micro mb-2">
        {title} · {unit}
      </figcaption>
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: W, display: "block" }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--signal)", stopOpacity: 0.9 }} />
            <stop offset="1" style={{ stopColor: "var(--signal)", stopOpacity: 0.05 }} />
          </linearGradient>
        </defs>
        {data.map((d, i) => {
          const cx = SLOT * i + SLOT / 2;
          const half = (SLOT * 0.7) / 2;
          const h = (Math.max(0, d.value) / max) * span;
          const apexY = BASE - h;
          return (
            <g key={`${d.label}-${i}`}>
              {h > 0 ? (
                <polygon
                  points={`${cx - half},${BASE} ${cx},${apexY} ${cx + half},${BASE}`}
                  fill={`url(#${gradientId})`}
                  style={{ stroke: "var(--signal)" }}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                />
              ) : null}
              <text
                x={cx}
                y={apexY - 6}
                textAnchor="middle"
                style={{ fill: "var(--text)", fontFamily: MONO, fontSize: 11 }}
              >
                {d.display}
              </text>
              <text
                x={cx}
                y={BASE + 17}
                textAnchor="middle"
                style={{ fill: "var(--text-muted)", fontFamily: MONO, fontSize: 11 }}
              >
                <title>{d.label}</title>
                {shortLabel(d.label)}
              </text>
            </g>
          );
        })}
        <line
          x1={0}
          y1={BASE}
          x2={W}
          y2={BASE}
          style={{ stroke: "var(--rule)" }}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <table className="sr-only">
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
    </figure>
  );
}
