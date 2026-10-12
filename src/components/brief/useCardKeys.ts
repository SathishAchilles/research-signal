"use client";

import { useEffect, useState } from "react";

const ACTION_KEYS: Record<string, string> = { r: "READ", c: "CLIENT", s: "SKIP" };

function typingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
}

// j/k move between cards, r/c/s set the focused card's action, Enter expands it, / focuses search, ? toggles help.
export function useCardKeys() {
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || typingTarget(event.target)) return;
      const cards = [...document.querySelectorAll<HTMLElement>("[data-card]")];
      const current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-card]") ?? null;
      const key = event.key;

      if (key === "j" || key === "k") {
        if (cards.length === 0) return;
        event.preventDefault();
        const index = current ? cards.indexOf(current) : -1;
        const next = key === "j" ? Math.min(index + 1, cards.length - 1) : Math.max(index - 1, 0);
        cards[next].focus();
        cards[next].scrollIntoView({
          block: "nearest",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
      } else if (key in ACTION_KEYS && current) {
        event.preventDefault();
        current.querySelector<HTMLButtonElement>(`[data-action="${ACTION_KEYS[key]}"]`)?.click();
      } else if (key === "Enter" && current && document.activeElement === current) {
        event.preventDefault();
        const details = current.querySelector("details");
        if (details) details.open = !details.open;
      } else if (key === "/") {
        const input = document.querySelector<HTMLInputElement>("[data-search-input]");
        if (input) {
          event.preventDefault();
          input.focus();
        }
      } else if (key === "?") {
        event.preventDefault();
        setHelpOpen((open) => !open);
      } else if (key === "Escape") {
        setHelpOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return { helpOpen, setHelpOpen };
}
