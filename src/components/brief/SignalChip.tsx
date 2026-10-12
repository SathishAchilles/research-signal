import { SIGNAL_BORDER } from "@/lib/brief/cues";
import type { SignalType } from "@/lib/pipeline/rank";

const SIGNAL_HELP: Record<SignalType, string> = {
  BENCH: "Introduces a benchmark or dataset",
  EVAL: "Surprising or contrary evaluation result",
  REFRAME: "Changes how a problem is framed",
  METHOD: "A new method",
};

export function SignalChip({ signal }: { signal: SignalType }) {
  return (
    <span
      className="inline-block px-1.5 text-[11px] leading-4 font-bold tracking-wide"
      style={{ border: `2px ${SIGNAL_BORDER[signal]} currentColor` }}
      title={SIGNAL_HELP[signal]}
    >
      {signal}
    </span>
  );
}
