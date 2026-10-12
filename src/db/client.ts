import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { db?: Db };

function getDb(): Db {
  if (globalForDb.db) return globalForDb.db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Supavisor's transaction pooler (:6543) does not support prepared statements.
  globalForDb.db = drizzle(postgres(url, { prepare: false, max: 5 }), { schema });
  return globalForDb.db;
}

// Connect on first use, so `next build` can import this module without a database.
export const db = new Proxy({} as Db, {
  get: (_target, property) => Reflect.get(getDb(), property),
});
