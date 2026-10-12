import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";

// Marks this script's queries in pg_stat_activity, so the ClientRead check ignores other apps.
const MARKER = "db-pool-smoke";
const ROUNDS = 5;
const PER_ROUND = 20;
const BURST_BUDGET_MS = 5000;

type Row = Record<string, unknown>;

function check(ok: boolean, message: string) {
  if (!ok) throw new Error(message);
}

function rowsOf(result: unknown): Row[] {
  return Array.from(result as Iterable<Row>);
}

function deadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// One of four query shapes: plain text, parameterized, drizzle select, and a parameterized statement
// that runs long enough for later queries to queue behind it.
function mixedQuery(round: number, i: number): Promise<unknown> {
  switch (i % 4) {
    case 0:
      return db.execute(sql.raw(`select 1 as n /* ${MARKER} */`));
    case 1:
      return db.execute(sql`select ${round * PER_ROUND + i}::int as n, ${MARKER}::text as tag /* ${sql.raw(MARKER)} */`);
    case 2:
      return db.select({ timezone: appSettings.timezone }).from(appSettings).limit(1);
    default:
      return db.execute(sql`select pg_sleep(0.05), ${i}::int as n /* ${sql.raw(MARKER)} */`);
  }
}

// xid of the open transaction and the backend running it; both must stay fixed inside one transaction.
const CURRENT = sql`select pg_current_xact_id()::text as xid, pg_backend_pid() as pid`;

async function xactStatus(xid: string): Promise<string> {
  const [row] = rowsOf(await db.execute(sql`select pg_xact_status(${xid}::xid8) as status`));
  return String(row.status);
}

// A burst must not strand a backend half-way through the extended protocol.
async function clientReadStragglers(): Promise<Row[]> {
  return rowsOf(
    await db.execute(sql`
      select pid, state, wait_event, extract(epoch from now() - state_change)::int as seconds
      from pg_stat_activity
      where state = 'active' and wait_event = 'ClientRead'
        and pid <> pg_backend_pid() and query like ${`%${MARKER}%`}
    `),
  );
}

async function burstWithTransaction(): Promise<number> {
  const started = Date.now();
  for (let round = 0; round < ROUNDS; round++) {
    const queries = Array.from({ length: PER_ROUND }, (_, i) => mixedQuery(round, i));
    // A transaction in the middle of the burst must neither stall nor be stalled by the pool.
    const tx = db.transaction(async (t) => {
      const seen = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const [row] = rowsOf(await t.execute(sql`${CURRENT} /* ${sql.raw(MARKER)} */`));
        seen.add(`${String(row.xid)}:${String(row.pid)}`);
      }
      check(seen.size === 1, `transaction statements ran on ${seen.size} server transactions`);
    });
    await deadline(Promise.all([...queries, tx]), BURST_BUDGET_MS, `round ${round + 1}`);
  }
  return Date.now() - started;
}

async function drizzleTransactions() {
  // Commit: a temp table written and read back inside the transaction, then the xid reported committed.
  const committed = await db.transaction(async (tx) => {
    await tx.execute(sql`create temp table db_pool_smoke (n int) on commit drop`);
    await tx.execute(sql`insert into db_pool_smoke values (${1}), (${2})`);
    // A failing savepoint rolls back only its own write.
    await tx
      .transaction(async (inner) => {
        await inner.execute(sql`insert into db_pool_smoke values (${3})`);
        throw new Error("savepoint rollback");
      })
      .catch((error: Error) => check(error.message === "savepoint rollback", error.message));
    const [count] = rowsOf(await tx.execute(sql`select count(*)::int as n from db_pool_smoke`));
    check(count.n === 2, `temp table holds ${String(count.n)} rows after the savepoint rollback, expected 2`);
    const [row] = rowsOf(await tx.execute(CURRENT));
    return String(row.xid);
  });
  const commitStatus = await xactStatus(committed);
  console.log(`db.transaction commit: xid ${committed} -> ${commitStatus}`);
  check(commitStatus === "committed", "db.transaction did not commit");

  // Rollback: a thrown error aborts the transaction and reaches the caller.
  let rolledBack = "";
  const error = await db
    .transaction(async (tx) => {
      const [row] = rowsOf(await tx.execute(CURRENT));
      rolledBack = String(row.xid);
      throw new Error("rollback on purpose");
    })
    .then(() => null, (e: Error) => e);
  check(error?.message === "rollback on purpose", "db.transaction did not rethrow the callback error");
  const rollbackStatus = await xactStatus(rolledBack);
  console.log(`db.transaction rollback: xid ${rolledBack} -> ${rollbackStatus}`);
  check(rollbackStatus === "aborted", "db.transaction did not roll back");

  // Explicit tx.rollback() from drizzle.
  let explicit = "";
  await db
    .transaction(async (tx) => {
      const [row] = rowsOf(await tx.execute(CURRENT));
      explicit = String(row.xid);
      tx.rollback();
    })
    .catch(() => undefined);
  const explicitStatus = await xactStatus(explicit);
  console.log(`db.transaction tx.rollback(): xid ${explicit} -> ${explicitStatus}`);
  check(explicitStatus === "aborted", "tx.rollback() did not roll back");
}

async function sqlBegin() {
  const client = db.$client;
  const [first, ...rest] = await client.begin(async (tx) => {
    const one = await tx`select pg_current_xact_id()::text as xid, pg_backend_pid() as pid, ${1}::int as n`;
    // Statements issued together inside a transaction pipeline on its reserved connection.
    const many = await Promise.all(
      [2, 3, 4].map((n) => tx`select pg_current_xact_id()::text as xid, pg_backend_pid() as pid, ${n}::int as n`),
    );
    return [one[0], ...many.map((r) => r[0])];
  });
  check(rest.every((r) => r.xid === first.xid && r.pid === first.pid), "sql.begin statements left the transaction");
  const status = await xactStatus(String(first.xid));
  console.log(`sql.begin commit: xid ${String(first.xid)} -> ${status}`);
  check(status === "committed", "sql.begin did not commit");

  let aborted = "";
  await client
    .begin(async (tx) => {
      const [row] = await tx`select pg_current_xact_id()::text as xid`;
      aborted = String(row.xid);
      throw new Error("abort");
    })
    .catch(() => undefined);
  const abortStatus = await xactStatus(aborted);
  console.log(`sql.begin rollback: xid ${aborted} -> ${abortStatus}`);
  check(abortStatus === "aborted", "sql.begin did not roll back");
}

export default async function run() {
  try {
    const ms = await burstWithTransaction();
    console.log(`${ROUNDS} rounds of ${PER_ROUND} concurrent mixed queries plus a transaction: ${ms} ms`);
    check(ms < BURST_BUDGET_MS, `burst took ${ms} ms, budget ${BURST_BUDGET_MS} ms`);

    // Give a stranded backend time to show up before looking for it.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const stragglers = await clientReadStragglers();
    console.log(`ClientRead stragglers from this run: ${stragglers.length}`);
    check(stragglers.length === 0, `stranded backends: ${JSON.stringify(stragglers)}`);

    await deadline(drizzleTransactions(), 15000, "drizzle transactions");
    await deadline(sqlBegin(), 15000, "sql.begin");
    console.log("db-pool smoke passed");
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
