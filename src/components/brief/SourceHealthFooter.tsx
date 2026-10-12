import type { ReactNode } from "react";
import { SpecTable } from "@/components/viz/SpecTable";
import type { BriefSelection } from "@/lib/brief/types";

// The brief's specimen spec table: coverage window, source health and the cue legend.
export function SourceHealthFooter({ selection, proseSource }: { selection: BriefSelection; proseSource: string }) {
  const degraded = selection.sourceHealth.length;
  const rows: [string, ReactNode][] = [
    ["Coverage", `Announcements ${selection.label}`],
    ["Sources", degraded === 0 ? "All normal" : `${degraded} degraded`],
    ...selection.sourceHealth.map((h): [string, ReactNode] => [
      h.kind,
      <>
        <span className="font-mono text-xs">{h.status}</span> · {h.note}
      </>,
    ]),
  ];
  if (proseSource === "fallback") rows.push(["Summaries", "plain extracts (the written summary did not pass checks)"]);

  return (
    <footer className="plate mt-4 flex flex-col gap-4 p-4 text-muted-foreground">
      <SpecTable caption="Source health" rows={rows} />
      <p className="border-t border-rule pt-3 text-xs">
        Legend: bar and label = suggested verdict; [####] = evidence rung (LAB, CODE, MODEL, PEER); boxed tag = signal
        type (BENCH solid, EVAL dashed, REFRAME dotted, METHOD double).
      </p>
    </footer>
  );
}
