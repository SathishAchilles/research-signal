"use client";

import { useActionState, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { verifyPin, type LoginState } from "./actions";

const LENGTH = 6;

export default function LoginPage() {
  const [digits, setDigits] = useState<string[]>(() => Array(LENGTH).fill(""));
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const [state, action, pending] = useActionState<LoginState, FormData>(
    async (_previous, formData) => {
      const result = await verifyPin(formData);
      setDigits(Array(LENGTH).fill(""));
      requestAnimationFrame(() => cells.current[0]?.focus());
      return result;
    },
    null,
  );
  const form = useRef<HTMLFormElement>(null);
  const pin = digits.join("");

  function fill(from: number, text: string) {
    const incoming = text.replace(/\D/g, "").slice(0, LENGTH - from);
    if (!incoming) return;
    const next = [...digits];
    for (let i = 0; i < incoming.length; i++) next[from + i] = incoming[i];
    setDigits(next);
    const last = Math.min(from + incoming.length, LENGTH - 1);
    cells.current[last]?.focus();
    if (next.every(Boolean)) requestAnimationFrame(() => form.current?.requestSubmit());
  }

  function onChange(index: number, value: string) {
    const current = digits[index];
    fill(index, current && value.startsWith(current) ? value.slice(current.length) : value);
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Backspace") return;
    event.preventDefault();
    const next = [...digits];
    const target = digits[index] ? index : Math.max(index - 1, 0);
    next[target] = "";
    setDigits(next);
    cells.current[target]?.focus();
  }

  function onPaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    fill(index, event.clipboardData.getData("text"));
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <form
        ref={form}
        action={action}
        className="flex w-full max-w-xs flex-col items-center gap-6"
      >
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">Research Signal</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enter your 6-digit PIN</p>
        </div>
        <input type="hidden" name="pin" value={pin} />
        <fieldset className="flex gap-2" disabled={pending} aria-label="PIN">
          {digits.map((digit, index) => (
            <Input
              key={index}
              ref={(element) => {
                cells.current[index] = element;
              }}
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d*"
              maxLength={LENGTH}
              autoFocus={index === 0}
              aria-label={`Digit ${index + 1}`}
              aria-invalid={state?.error ? true : undefined}
              value={digit}
              onChange={(event) => onChange(index, event.target.value)}
              onKeyDown={(event) => onKeyDown(index, event)}
              onPaste={(event) => onPaste(index, event)}
              className="h-12 w-10 text-center text-lg"
            />
          ))}
        </fieldset>
        <p role="alert" className="min-h-5 text-center text-sm text-destructive">
          {state?.error ?? ""}
        </p>
        <Button type="submit" className="w-full" disabled={pending || pin.length < LENGTH}>
          {pending ? "Checking…" : "Unlock"}
        </Button>
      </form>
    </main>
  );
}
