"use client";

import type { ReactNode } from "react";
import { useCardKeys } from "./useCardKeys";

const KEYS: [string, string][] = [
  ["j / k", "Next / previous card"],
  ["r", "Mark Read"],
  ["c", "Bring to client"],
  ["s", "Skip"],
  ["Enter", "Show abstract"],
  ["/", "Search"],
  ["?", "This help"],
];

export function BriefShell({ children }: { children: ReactNode }) {
  const { helpOpen, setHelpOpen } = useCardKeys();
  return (
    <>
      {children}
      {helpOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setHelpOpen(false)}>
          <div className="w-72 rounded-lg border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 font-semibold">Keyboard shortcuts</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {KEYS.map(([key, label]) => (
                <div key={key} className="contents">
                  <dt className="font-mono">{key}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}
    </>
  );
}
