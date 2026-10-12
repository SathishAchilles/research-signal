"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveDelivery } from "./actions";

type Values = { recipients: string; sendLocalTime: string; timezone: string };

export function DeliveryForm({ initial, timezones }: { initial: Values; timezones: string[] }) {
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof Values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await saveDelivery(values);
          setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="recipients">Recipients</Label>
        <Textarea id="recipients" rows={3} value={values.recipients} onChange={set("recipients")} />
        <p className="text-xs text-muted-foreground">One email address per line, or comma-separated.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="send-time">Send time</Label>
        <Input id="send-time" type="time" value={values.sendLocalTime} onChange={set("sendLocalTime")} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <Input id="timezone" list="timezones" value={values.timezone} onChange={set("timezone")} required />
        <datalist id="timezones">
          {timezones.map((tz) => (
            <option key={tz} value={tz} />
          ))}
        </datalist>
      </div>
      <p role="status" className={message?.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
        {message?.text}
      </p>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
