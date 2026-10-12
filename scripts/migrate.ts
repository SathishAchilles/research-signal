// Applies drizzle/*.sql in order. Usage: npm run db:migrate
//
// drizzle-kit's own migrator runs `CREATE SCHEMA IF NOT EXISTS`, which needs database-level
// CREATE rights that rs_app deliberately lacks. This runner only creates objects inside the
// existing schema and records each applied file in research_signal.__migrations.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const target = "research_signal";
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error("DATABASE_MIGRATION_URL is not set");

const sql = postgres(url, { max: 1, onnotice: () => {} });

function statements(file: string): string[] {
  const text = readFileSync(join("drizzle", file), "utf8");
  return text
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  const files = readdirSync("drizzle")
    .filter((file) => file.endsWith(".sql"))
    .sort();

  await sql.unsafe(`create table if not exists "${target}"."__migrations" (
    name text primary key,
    hash text not null,
    applied_at timestamptz not null default now()
  )`);
  await sql.unsafe(`alter table "${target}"."__migrations" enable row level security`);

  const applied = new Map(
    (await sql.unsafe<{ name: string; hash: string }[]>(`select name, hash from "${target}"."__migrations"`)).map(
      (row) => [row.name, row.hash],
    ),
  );

  for (const file of files) {
    const hash = createHash("sha256").update(readFileSync(join("drizzle", file))).digest("hex");
    const previous = applied.get(file);
    if (previous) {
      if (previous !== hash) throw new Error(`${file} changed after it was applied to ${target}`);
      continue;
    }
    await sql.begin(async (tx) => {
      for (const statement of statements(file)) await tx.unsafe(statement);
      await tx.unsafe(`insert into "${target}"."__migrations" (name, hash) values ($1, $2)`, [file, hash]);
    });
    console.log(`applied ${file} to ${target}`);
  }

  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from information_schema.tables
    where table_schema = ${target} and table_type = 'BASE TABLE' and table_name <> '__migrations'`;
  console.log(`${target}: ${count} tables`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
