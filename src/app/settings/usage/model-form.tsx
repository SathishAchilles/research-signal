"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveModels } from "./actions";

type Values = { chatModel: string; embedModel: string };

export function ModelForm({ initial }: { initial: Values }) {
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const embedChanged = values.embedModel.trim() !== initial.embedModel;

  return (
    <form
      className="flex max-w-md flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await saveModels(values);
          setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="chat-model">Chat model</Label>
        <Input
          id="chat-model"
          value={values.chatModel}
          onChange={(e) => setValues((v) => ({ ...v, chatModel: e.target.value }))}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="embed-model">Embedding model</Label>
        <Input
          id="embed-model"
          value={values.embedModel}
          onChange={(e) => setValues((v) => ({ ...v, embedModel: e.target.value }))}
          required
        />
        {embedChanged && (
          <p className="text-xs text-muted-foreground">
            Stored vectors come from the current model; changing it makes them incomparable until papers are
            re-embedded.
          </p>
        )}
      </div>
      <p role="status" className={message?.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
        {message?.text}
      </p>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Checking…" : "Save models"}
      </Button>
    </form>
  );
}
