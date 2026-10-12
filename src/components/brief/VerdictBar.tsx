import { COLORS_UI, VERDICT_LABEL } from "@/lib/brief/cues";
import type { Verdict } from "@/lib/pipeline/rank";

// A colored edge plus the verdict in words, so the cue survives without color.
// Under forced colors the bar opts out of palette replacement and paints CanvasText, so it stays visible.
export function VerdictBar({ verdict }: { verdict: Verdict }) {
  return (
    <span
      aria-hidden
      className="absolute inset-y-0 left-0 w-1 rounded-l-[inherit] forced-colors:[forced-color-adjust:none] forced-colors:!bg-[CanvasText]"
      style={{ backgroundColor: COLORS_UI.verdict[verdict] }}
      data-verdict={verdict}
    />
  );
}

export function VerdictLabel({ verdict }: { verdict: Verdict }) {
  return (
    <span className="font-mono text-[11px] font-medium tracking-[.08em]" style={{ color: COLORS_UI.verdict[verdict] }}>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}
