import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sleep } from "./types";

export const ARXIV_MIN_INTERVAL_MS = 3100;
const LEASE_NAME = "arxiv";
const POLL_MS = 1000;

let lastRequestAt = 0;

async function acquire(holder: string): Promise<boolean> {
  const rows = await db.execute(sql`
    insert into research_signal.leases (name, holder, expires_at)
    values (${LEASE_NAME}, ${holder}, now() + interval '5 min')
    on conflict (name) do update set holder = excluded.holder, expires_at = excluded.expires_at
    where leases.expires_at < now()
    returning holder`);
  return rows.length > 0;
}

// Pushes expiry another five minutes before each request, so a long run (a multi-page backfill)
// keeps the lease. Returns false when another process has taken it after it expired.
async function renew(holder: string): Promise<boolean> {
  const rows = await db.execute(sql`
    update research_signal.leases
    set expires_at = now() + interval '5 min'
    where name = ${LEASE_NAME} and holder = ${holder}
    returning holder`);
  return rows.length > 0;
}

// The lease stays held for the minimum interval after the last request, so the
// spacing also holds when another process (another route or a script) takes it next.
async function release(holder: string, usedArxiv: boolean): Promise<void> {
  const holdMs = usedArxiv ? ARXIV_MIN_INTERVAL_MS : 0;
  await db.execute(sql`
    update research_signal.leases
    set expires_at = now() + make_interval(secs => ${holdMs / 1000})
    where name = ${LEASE_NAME} and holder = ${holder}`);
}

export async function withArxivLease<T>(
  holder: string,
  fn: (wait: () => Promise<void>) => Promise<T>,
  options: { maxWaitMs?: number } = {},
): Promise<T | "busy"> {
  const id = `${holder}:${randomUUID().slice(0, 8)}`;
  const deadline = Date.now() + (options.maxWaitMs ?? 0);
  while (!(await acquire(id))) {
    if (Date.now() + POLL_MS > deadline) return "busy";
    await sleep(POLL_MS);
  }

  let usedArxiv = false;
  const wait = async () => {
    if (!(await renew(id))) throw new Error("arXiv lease lost to another holder; stopping requests");
    const remaining = lastRequestAt + ARXIV_MIN_INTERVAL_MS - Date.now();
    if (remaining > 0) await sleep(remaining);
    lastRequestAt = Date.now();
    usedArxiv = true;
  };

  try {
    return await fn(wait);
  } finally {
    if (usedArxiv) lastRequestAt = Date.now();
    await release(id, usedArxiv);
  }
}
