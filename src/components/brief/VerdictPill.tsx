import { Badge } from "@/components/ui/badge";
import { COLORS_UI, VERDICT_LABEL } from "@/lib/brief/cues";
import type { Verdict } from "@/lib/pipeline/rank";
import { cn } from "@/lib/utils";

// The one verdict cue outside the brief cards: the verdict in words (SHARE WITH CLIENTS / READ /
// SKIP) on a capsule tinted with its COLORS_UI color, so it reads the same on /log, /search and
// /paper and survives without color. A null or unknown verdict renders a neutral UNSCORED pill.
export function VerdictPill({ verdict, className }: { verdict: Verdict | null | undefined; className?: string }) {
  const known = verdict != null && verdict in VERDICT_LABEL;
  return (
    <Badge
      variant="verdict"
      className={cn(!known && "text-muted-foreground", className)}
      style={known ? { color: COLORS_UI.verdict[verdict] } : undefined}
      data-verdict={known ? verdict : "UNSCORED"}
    >
      {known ? VERDICT_LABEL[verdict] : "UNSCORED"}
    </Badge>
  );
}
