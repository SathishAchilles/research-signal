"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { updateAction } from "./actions";

export function NoteEditor({ paperId, note, clientTag, editable }: { paperId: string; note: string; clientTag: string; editable: boolean }) {
  const [values, setValues] = useState({ note, clientTag });
  const [saved, setSaved] = useState({ note, clientTag });
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const dirty = values.note !== saved.note || values.clientTag !== saved.clientTag;

  if (!editable) return <span className="text-xs text-muted-foreground">{note || "—"}</span>;

  function save() {
    startTransition(async () => {
      const result = await updateAction(paperId, values.note, values.clientTag);
      if (result.ok) setSaved(values);
      setFailed(!result.ok);
      setMessage(result.ok ? "Saved" : (result.error ?? "Could not save"));
    });
  }

  return (
    <form
      className="flex min-w-72 flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Input aria-label="Note" placeholder="Note" className="h-8" value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} />
      <div className="flex items-center gap-1.5">
        <Input
          aria-label="Client tag"
          placeholder="Client tag"
          className="h-8 w-32"
          value={values.clientTag}
          onChange={(e) => setValues({ ...values, clientTag: e.target.value })}
        />
        <Button type="submit" size="sm" variant="outline" className="rounded-full px-3" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <span role="status" className={cn("font-mono text-[11px] tracking-[.04em]", failed ? "text-destructive" : "text-signal-2")}>
          {dirty ? "" : message}
        </span>
      </div>
    </form>
  );
}
