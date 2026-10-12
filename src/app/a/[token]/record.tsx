"use client";

import { useEffect, useRef, useState } from "react";

type State = "pending" | "recorded" | "error";

// Posts the signed action once the page has loaded in a browser; plain fetches by link scanners run no script.
export function RecordAction({ token, alreadyRecorded, disabled }: { token: string; alreadyRecorded: boolean; disabled: boolean }) {
  const [state, setState] = useState<State>(alreadyRecorded ? "recorded" : "pending");
  const sent = useRef(false);

  useEffect(() => {
    if (alreadyRecorded || disabled || sent.current) return;
    sent.current = true;
    fetch("/api/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      redirect: "error",
    })
      .then((response) => setState(response.ok && !response.redirected ? "recorded" : "error"))
      .catch(() => setState("error"));
  }, [token, alreadyRecorded, disabled]);

  if (disabled) return <p className="text-sm text-destructive">This paper is no longer stored, so nothing was recorded.</p>;
  return (
    <p role="status" className={state === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
      {state === "pending" ? "Recording…" : state === "recorded" ? "Recorded. You can close this page." : "Could not record the action. Try again."}
    </p>
  );
}
