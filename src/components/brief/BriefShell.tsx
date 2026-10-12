"use client";

import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { useCardKeys } from "./useCardKeys";

const KEYS: [string, string][] = [
  ["j / k", "Next / previous card"],
  ["r", "Mark Read"],
  ["c", "Share with clients"],
  ["s", "Skip"],
  ["Enter", "Show abstract"],
  ["/", "Ask"],
  ["?", "This help"],
];

// The element(s) linked to a hovered or focused element: a figure-stage callout links to its card,
// and a card links back to its callout. Only the counterpart is marked, never the element itself.
function counterparts(target: EventTarget | null): Element[] {
  const el = target instanceof Element ? target : null;
  if (!el) return [];
  const callout = el.closest<HTMLElement>("[data-stage-target]");
  if (callout) {
    const card = document.getElementById(`card-${callout.dataset.stageTarget}`);
    return card ? [card] : [];
  }
  const card = el.closest<HTMLElement>("[data-card]");
  if (card?.id.startsWith("card-")) {
    return [...document.querySelectorAll(`[data-stage-target="${CSS.escape(card.id.slice(5))}"]`)];
  }
  return [];
}

function useStageSync() {
  useEffect(() => {
    let hovered: Element[] = [];
    let focused: Element[] = [];
    let marked = new Set<Element>();

    const apply = () => {
      const next = new Set([...hovered, ...focused]);
      marked.forEach((el) => {
        if (!next.has(el)) el.removeAttribute("data-linked");
      });
      next.forEach((el) => el.setAttribute("data-linked", ""));
      marked = next;
    };
    const onOver = (e: PointerEvent) => {
      hovered = counterparts(e.target);
      apply();
    };
    const onOut = (e: PointerEvent) => {
      if (e.relatedTarget) return; // pointerover on the next element updates the set
      hovered = [];
      apply();
    };
    const onFocusIn = (e: FocusEvent) => {
      focused = counterparts(e.target);
      apply();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) return; // focusin on the next element updates the set
      focused = [];
      apply();
    };
    // A callout click scrolls its card into view and focuses it, so j/k continues from there.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const callout = e.target instanceof Element ? e.target.closest<HTMLElement>("a[data-stage-target]") : null;
      const card = callout ? document.getElementById(`card-${callout.dataset.stageTarget}`) : null;
      if (!card) return;
      e.preventDefault();
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      card.focus({ preventScroll: true });
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("click", onClick);
      marked.forEach((el) => el.removeAttribute("data-linked"));
    };
  }, []);
}

export function BriefShell({ children }: { children: ReactNode }) {
  const { helpOpen, setHelpOpen } = useCardKeys();
  useStageSync();
  return (
    <>
      {children}
      {helpOpen
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Keyboard shortcuts"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/55"
              onClick={() => setHelpOpen(false)}
            >
              <div className="glass-elevated w-80 p-5" onClick={(e) => e.stopPropagation()}>
                <h2 className="micro mb-3">Keyboard shortcuts</h2>
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
                  {KEYS.map(([key, label]) => (
                    <div key={key} className="contents">
                      <dt>
                        <kbd className="glass-chip inline-block px-2 py-0.5 font-mono text-xs text-foreground">{key}</kbd>
                      </dt>
                      <dd>{label}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
