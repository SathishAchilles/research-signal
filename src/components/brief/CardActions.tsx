"use client";

import { useState } from "react";
import type { ActionKind } from "@/lib/brief/types";

const BUTTONS: { action: ActionKind; label: string; key: string }[] = [
  { action: "READ", label: "Read", key: "r" },
  { action: "CLIENT", label: "Share with clients", key: "c" },
  { action: "SKIP", label: "Skip", key: "s" },
];

export function CardActions({ paperId, initial }: { paperId: string; initial: ActionKind | null }) {
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

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Your action">
      {BUTTONS.map((b) => (
        <button
          key={b.action}
          type="button"
          data-action={b.action}
          aria-pressed={current === b.action}
          onClick={() => choose(b.action)}
          className="glass-chip glass-interactive px-2.5 py-0.5 text-xs font-medium aria-pressed:border-signal aria-pressed:bg-signal aria-pressed:text-[#03201D]"
          title={`${b.label} (${b.key})`}
        >
          {current === b.action ? "✓ " : ""}
          {b.label}
        </button>
      ))}
      {error ? <span className="text-xs text-destructive">Not saved</span> : null}
    </div>
  );
}
