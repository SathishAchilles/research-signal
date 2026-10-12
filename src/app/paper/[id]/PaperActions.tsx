"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const ACTIONS = [
  { action: "READ", label: "Read" },
  { action: "CLIENT", label: "Bring to client" },
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
    <div className="flex flex-wrap items-center gap-2">
      {ACTIONS.map(({ action, label }) => (
        <Button
          key={action}
          variant={chosen === action ? "default" : "outline"}
          size="sm"
          disabled={pending}
          onClick={() => record(action)}
        >
          {label}
        </Button>
      ))}
      {error ? <span role="status" className="text-sm text-destructive">{error}</span> : null}
    </div>
  );
}
