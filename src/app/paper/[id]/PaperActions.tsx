"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const ACTIONS = [
  { action: "READ", label: "Read" },
  { action: "CLIENT", label: "Share with clients" },
  { action: "SKIP", label: "Skip" },
] as const;

export function PaperActions({ paperId, current }: { paperId: string; current: string | null }) {
  const [chosen, setChosen] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function record(action: (typeof ACTIONS)[number]["action"]) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paperId, action, origin: "web" }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setChosen(action);
    } catch (e) {
      setError(`Could not record the action (${e instanceof Error ? e.message : "error"})`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Your action">
      {ACTIONS.map(({ action, label }) => (
        <Button
          key={action}
          variant={chosen === action ? "default" : "outline"}
          size="sm"
          aria-pressed={chosen === action}
          className="px-3 touch:h-11 touch:px-4 touch:text-sm"
          disabled={pending}
          onClick={() => record(action)}
        >
          {chosen === action ? "✓ " : ""}
          {label}
        </Button>
      ))}
      {error ? <span role="status" className="text-sm text-destructive">{error}</span> : null}
    </div>
  );
}

// The abstract opens clamped to four lines; "Show more" appears only when the text actually overflows.
export function CollapsibleAbstract({ text }: { text: string }) {
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  return (
    <div className="flex flex-col items-start gap-2">
      <p
        id={id}
        ref={ref}
        data-abstract={open ? "open" : "clamped"}
        className={`max-w-prose text-[15px] leading-7 ${open ? "" : "line-clamp-4"}`}
      >
        {text}
      </p>
      {overflows || open ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="micro rounded-sm text-signal underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus touch:min-h-11"
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
