import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Client = Db["$client"];

// Supavisor's transaction pooler (:6543) does not support prepared statements, and it hands the
// server connection back on each ReadyForQuery. A parameterized query sends Parse/Describe/Flush
// and only sends Bind/Execute/Sync after the Describe reply, so a query pipelined behind another one
// lands its two halves on different server connections: one backend sits "active" in ClientRead
// and the request waits until statement_timeout. max_pipeline: 0 keeps the shared pool at one query
// per connection. max_pipeline: 1 is not enough, because postgres-js checks the limit after queueing
// the query, so one query still pipelines and the pool hangs under a burst.
const QUERY_OPTIONS = {
  prepare: false,
  max: 5,
  max_pipeline: 0,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 60 * 30,
};

// max_pipeline: 0 also stops sql.begin: postgres-js only calls begin's onexecute, which reserves the
// connection, while the pipeline has room, so the BEGIN reply fails with UNSAFE_TRANSACTION. A second
// small pool on the same pooler runs only transactions with the default pipeline. Nothing else is
// sent to it, so no query is ever pipelined behind another client's, and inside a transaction
// Supavisor keeps the server connection until COMMIT or ROLLBACK returns it idle.
const TRANSACTION_OPTIONS = {
  prepare: false,
  max: 2,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 60 * 30,
};

// max_pipeline is a runtime option missing from the postgres-js types, so the options are not typed literals.
const SIGNATURE = JSON.stringify([QUERY_OPTIONS, TRANSACTION_OPTIONS]);

const globalForDb = globalThis as unknown as { db?: Db; txDb?: Db; dbSignature?: string };

function getDbs(): { db: Db; txDb: Db } {
  if (globalForDb.db && globalForDb.txDb && globalForDb.dbSignature === SIGNATURE) {
    return { db: globalForDb.db, txDb: globalForDb.txDb };
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // A dev reload with changed options replaces the cached pools instead of reusing their sockets.
  void globalForDb.db?.$client.end({ timeout: 0 });
  void globalForDb.txDb?.$client.end({ timeout: 0 });

  const queries = postgres(url, QUERY_OPTIONS);
  const transactions = postgres(url, TRANSACTION_OPTIONS);
  // $client keeps the query pool, except that sql.begin runs on the transaction pool and end() closes both.
  const client = new Proxy(queries, {
    get(target, property, receiver) {
      if (property === "begin") return transactions.begin.bind(transactions);
      if (property === "end") {
        return async (options?: Parameters<Client["end"]>[0]) => {
          await Promise.all([target.end(options), transactions.end(options)]);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  globalForDb.db = drizzle(client, { schema });
  globalForDb.txDb = drizzle(transactions, { schema });
  globalForDb.dbSignature = SIGNATURE;
  return { db: globalForDb.db, txDb: globalForDb.txDb };
}

// Connect on first use, so `next build` can import this module without a database.
// db.transaction runs on the transaction pool; every other call goes to the query pool.
export const db = new Proxy({} as Db, {
  get: (_target, property) => {
    const { db: queryDb, txDb } = getDbs();
    if (property === "transaction") return txDb.transaction.bind(txDb);
    return Reflect.get(queryDb, property);
  },
});
