"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateAction } from "./actions";

export function NoteEditor({ paperId, note, clientTag, editable }: { paperId: string; note: string; clientTag: string; editable: boolean }) {
  const [values, setValues] = useState({ note, clientTag });
  const [saved, setSaved] = useState({ note, clientTag });
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const dirty = values.note !== saved.note || values.clientTag !== saved.clientTag;

  if (!editable) return <span className="text-xs text-muted-foreground">{note || "—"}</span>;

  function save() {
    startTransition(async () => {
      const result = await updateAction(paperId, values.note, values.clientTag);
      if (result.ok) setSaved(values);
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
      <Input aria-label="Note" placeholder="Note" value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} />
      <div className="flex items-center gap-1.5">
        <Input
          aria-label="Client tag"
          placeholder="Client tag"
          className="w-32"
          value={values.clientTag}
          onChange={(e) => setValues({ ...values, clientTag: e.target.value })}
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <span role="status" className="text-xs text-muted-foreground">
          {dirty ? "" : message}
        </span>
      </div>
    </form>
  );
}
