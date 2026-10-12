import { COLORS, VERDICT_LABEL } from "@/lib/brief/cues";
import type { Verdict } from "@/lib/pipeline/rank";

// A colored edge plus the verdict in words, so the cue survives without color.
export function VerdictBar({ verdict }: { verdict: Verdict }) {
  return (
    <span
      aria-hidden
      className="absolute inset-y-0 left-0 w-1 rounded-l-md"
      style={{ backgroundColor: COLORS.verdict[verdict] }}
      data-verdict={verdict}
    />
  );
}

export function VerdictLabel({ verdict }: { verdict: Verdict }) {
  return (
    <span className="text-xs font-bold tracking-wide" style={{ color: COLORS.verdict[verdict] }}>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}
