"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePin, type ChangePinResult } from "./actions";

const FIELDS = [
  { name: "current", label: "Current PIN", autoComplete: "current-password" },
  { name: "next", label: "New PIN", autoComplete: "new-password" },
  { name: "confirm", label: "Repeat new PIN", autoComplete: "new-password" },
] as const;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export default function SecuritySettingsPage() {
  const [state, action, pending] = useActionState<ChangePinResult | null, FormData>(
    (_previous, formData) =>
      changePin(field(formData, "current"), field(formData, "next"), field(formData, "confirm")),
    null,
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">Change the 6-digit PIN used to sign in.</p>
      </div>
      <form action={action} className="flex flex-col gap-4">
        {FIELDS.map(({ name, label, autoComplete }) => (
          <div key={name} className="flex flex-col gap-1.5">
            <Label htmlFor={`pin-${name}`}>{label}</Label>
            <Input
              id={`pin-${name}`}
              name={name}
              type="password"
              inputMode="numeric"
              autoComplete={autoComplete}
              pattern="\d{6}"
              maxLength={6}
              required
            />
          </div>
        ))}
        <p role="status" className={state?.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {state ? (state.ok ? "PIN changed." : state.error) : ""}
        </p>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Change PIN"}
        </Button>
      </form>
    </main>
  );
}
