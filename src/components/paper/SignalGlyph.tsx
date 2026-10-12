import type { ReactNode } from "react";
import type { SignalType } from "@/lib/pipeline/rank";

// Line glyphs for papers with no figure, one per signal type, drawn in currentColor on a 48×48 grid:
// BENCH a leaderboard, EVAL a scatter around a trend line, REFRAME crossing arrows, METHOD a node graph.
const GLYPHS: Record<SignalType, ReactNode> = {
  BENCH: (
    <>
      <path d="M8 40h32" opacity={0.5} />
      <path d="M10 12h28M10 20h22M10 28h16M10 36h9" strokeWidth={3.5} />
      <circle cx="42" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  EVAL: (
    <>
      <path d="M8 8v32h32" opacity={0.5} />
      <path d="M12 36L40 12" strokeDasharray="2 3" opacity={0.6} />
      <circle cx="15" cy="31" r="1.8" />
      <circle cx="20" cy="29" r="1.8" />
      <circle cx="23" cy="23" r="1.8" />
      <circle cx="29" cy="22" r="1.8" />
      <circle cx="33" cy="15" r="1.8" />
      <circle cx="37" cy="17" r="1.8" />
      <circle cx="34" cy="33" r="2.6" fill="currentColor" stroke="none" />
    </>
  ),
  REFRAME: (
    <>
      <path d="M8 36C18 36 30 12 40 12" />
      <path d="M8 12C18 12 30 36 40 36" />
      <path d="M35 8l5 4-5 4M35 32l5 4-5 4" />
    </>
  ),
  METHOD: (
    <>
      <path d="M12 24l12-12M12 24l12 12M24 12l12 12M24 36l12-12M24 12v24" opacity={0.6} />
      <circle cx="12" cy="24" r="3.5" />
      <circle cx="24" cy="12" r="3.5" />
      <circle cx="24" cy="36" r="3.5" />
      <circle cx="36" cy="24" r="3.5" fill="currentColor" />
    </>
  ),
};

const HELP: Record<SignalType, string> = {
  BENCH: "benchmark",
  EVAL: "evaluation",
  REFRAME: "reframing",
  METHOD: "method",
};

export function signalGlyphLabel(signalType: SignalType | null): string {
  return signalType ? `No figure: ${HELP[signalType]} paper (${signalType})` : "No figure";
}

// Inline SVG in the cyan line style. Decorative by default; pass `label` to expose it as an image.
export function SignalGlyph({
  signalType,
  size = "40%",
  label,
  className,
}: {
  signalType: SignalType | null;
  size?: number | string;
  label?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true, focusable: false })}
    >
      {signalType ? GLYPHS[signalType] : <rect x="8" y="8" width="32" height="32" rx="2" strokeDasharray="4 4" />}
    </svg>
  );
}
