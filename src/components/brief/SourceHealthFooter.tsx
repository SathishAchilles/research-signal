import type { BriefSelection } from "@/lib/brief/types";

export function SourceHealthFooter({ selection, proseSource }: { selection: BriefSelection; proseSource: string }) {
  return (
    <footer className="mt-4 flex flex-col gap-2 border-t pt-4 text-xs text-muted-foreground">
      <p>Covers announcements {selection.label}.</p>
      <div>
        <p>Source health:</p>
        <ul className="ml-4 list-disc">
          {selection.sourceHealth.length === 0 ? (
            <li>All sources reported normally.</li>
          ) : (
            selection.sourceHealth.map((h) => (
              <li key={h.kind}>
                <span className="font-medium">{h.kind}</span> ({h.status}): {h.note}
              </li>
            ))
          )}
        </ul>
      </div>
      {proseSource === "fallback" ? <p>Summaries this week are plain extracts; the written summary did not pass checks.</p> : null}
      <p>
        Legend: bar and label = suggested verdict; [####] = evidence rung (LAB, CODE, MODEL, PEER); boxed tag = signal
        type (BENCH solid, EVAL dashed, REFRAME dotted, METHOD double).
      </p>
    </footer>
  );
}
