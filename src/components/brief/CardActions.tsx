"use client";

import { BookOpen, Share2, X } from "lucide-react";
import { useState } from "react";
import type { ActionKind } from "@/lib/brief/types";

const BUTTONS: { action: ActionKind; label: string; key: string; Icon: typeof BookOpen }[] = [
  { action: "READ", label: "Read", key: "r", Icon: BookOpen },
  { action: "CLIENT", label: "Share with clients", key: "c", Icon: Share2 },
  { action: "SKIP", label: "Skip", key: "s", Icon: X },
];

// "text" is the labelled chip row under a card; "icon" is the inline row of a compact row: icon-only
// buttons named by aria-label, with a CSS tooltip on hover and keyboard focus, 44 x 44px on touch.
export function CardActions({
  paperId,
  initial,
  variant = "text",
}: {
  paperId: string;
  initial: ActionKind | null;
  variant?: "text" | "icon";
}) {
  const [current, setCurrent] = useState<ActionKind | null>(initial);
  const [error, setError] = useState(false);

  async function choose(action: ActionKind) {
    const previous = current;
    setCurrent(action);
    setError(false);
    const response = await fetch("/api/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paperId, action }),
      redirect: "error",
    }).catch(() => null);
    if (!response?.ok) {
      setCurrent(previous);
      setError(true);
    }
  }

  if (variant === "icon") {
    return (
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Your action">
        {error ? <span className="text-xs text-destructive">Not saved</span> : null}
        {BUTTONS.map(({ action, label, key, Icon }) => (
          <button
            key={action}
            type="button"
            data-action={action}
            aria-pressed={current === action}
            aria-label={label}
            onClick={() => choose(action)}
            className="group/act glass-chip glass-interactive relative inline-flex size-7 items-center justify-center p-0 touch:size-11 aria-pressed:border-signal aria-pressed:bg-signal aria-pressed:text-[#03201D]"
          >
            <Icon aria-hidden className="size-3.5 touch:size-4" strokeWidth={2.25} />
            <span
              aria-hidden
              className="pointer-events-none absolute right-0 bottom-full z-20 mb-1.5 rounded-md border border-chip-border bg-popover px-2 py-1 font-mono text-[11px] whitespace-nowrap text-popover-foreground opacity-0 shadow-md transition-opacity duration-100 group-hover/act:opacity-100 group-focus-visible/act:opacity-100"
            >
              {current === action ? "✓ " : ""}
              {label} <kbd className="text-muted-foreground">{key}</kbd>
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 touch:gap-2" role="group" aria-label="Your action">
      {BUTTONS.map((b) => (
        <button
          key={b.action}
          type="button"
          data-action={b.action}
          aria-pressed={current === b.action}
          onClick={() => choose(b.action)}
          className="glass-chip glass-interactive px-2.5 py-0.5 text-xs font-medium whitespace-nowrap touch:min-h-11 touch:flex-auto touch:px-4 touch:text-sm aria-pressed:border-signal aria-pressed:bg-signal aria-pressed:text-[#03201D]"
          title={`${b.label} (${b.key})`}
        >
          {current === b.action ? "✓ " : ""}
          {b.label}
        </button>
      ))}
      {error ? <span className="text-xs text-destructive touch:text-sm">Not saved</span> : null}
    </div>
  );
}
