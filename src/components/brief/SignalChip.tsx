import { SIGNAL_BORDER } from "@/lib/brief/cues";
import type { SignalType } from "@/lib/pipeline/rank";

const SIGNAL_HELP: Record<SignalType, string> = {
  BENCH: "Introduces a benchmark or dataset",
  EVAL: "Surprising or contrary evaluation result",
  REFRAME: "Changes how a problem is framed",
  METHOD: "A new method",
};

// The border style carries the meaning (BENCH solid, EVAL dashed, REFRAME dotted, METHOD double), so no
// glass utility may touch it. METHOD needs 3px for `double` to draw two lines.
export function SignalChip({ signal }: { signal: SignalType }) {
  return (
    <span
      className="inline-block rounded-full bg-[rgb(127_224_230/.08)] px-2 font-mono text-[11px] leading-4 font-medium tracking-[.06em] text-foreground"
      style={{ border: `${signal === "METHOD" ? 3 : 2}px ${SIGNAL_BORDER[signal]} currentColor` }}
      title={SIGNAL_HELP[signal]}
    >
      {signal}
    </span>
  );
}
