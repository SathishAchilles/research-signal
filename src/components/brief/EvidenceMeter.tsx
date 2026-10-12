import { RUNG_LEVEL, meterText } from "@/lib/brief/cues";
import type { Rung } from "@/lib/pipeline/rank";

const RUNG_HELP: Record<Rung, string> = {
  LAB: "Lab only: no code, models or peer review yet",
  CODE: "Code released",
  MODEL: "Models or Spaces on Hugging Face",
  PEER: "Peer reviewed or accepted at a venue",
};

// Reached cells are filled, unreached cells are dashed outlines, so the state never relies on color alone.
export function EvidenceMeter({ rung }: { rung: Rung }) {
  const level = RUNG_LEVEL[rung];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" title={RUNG_HELP[rung]}>
      <span aria-hidden className="inline-flex gap-0.5">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={
              i <= level
                ? "h-2.5 w-2 rounded-[1px] border border-signal bg-signal shadow-[0_0_6px_rgb(63_224_208/.5)]"
                : "h-2.5 w-2 rounded-[1px] border border-dashed border-chip-border"
            }
          />
        ))}
      </span>
      <span className="font-mono">{meterText(rung)}</span>
    </span>
  );
}
