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
      <form ref={form} action={action} className="glass-elevated flex w-full max-w-[24rem] flex-col items-center gap-6 px-5 py-7 sm:px-7">
        <div className="flex flex-col items-center gap-3 text-center">
          <svg aria-hidden focusable="false" viewBox="0 0 32 32" className="size-9 text-signal">
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="1.5" opacity={0.7} />
            <circle cx="16" cy="16" r="8" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" opacity={0.5} />
            <circle cx="16" cy="16" r="3" fill="currentColor" />
          </svg>
          <h1 className="font-display text-[28px] leading-none font-semibold tracking-tight uppercase">
            Research <span className="text-signal-2">Signal</span>
          </h1>
          <p className="micro">Enter your 6-digit PIN</p>
        </div>
        <input type="hidden" name="pin" value={pin} />
        <fieldset className="grid w-full grid-cols-6 justify-items-center gap-1.5 sm:gap-2" disabled={pending} aria-label="PIN">
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
              className="h-14 w-full max-w-12 rounded-tile border-[1.5px] border-input bg-plate-solid px-0 text-center font-mono text-xl md:text-xl"
            />
          ))}
        </fieldset>
        <p role="alert" className="-my-2 min-h-5 text-center text-sm text-destructive">
          {state?.error ?? ""}
        </p>
        <Button type="submit" className="h-10 w-full" disabled={pending || pin.length < LENGTH}>
          {pending ? "Checking…" : "Unlock"}
        </Button>
      </form>
    </main>
  );
}
