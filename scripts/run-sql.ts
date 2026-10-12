// Runs one SQL file as the project's postgres user. Usage: npm run sql -- scripts/sql/<file>.sql
// Every __NAME__ placeholder is replaced with process.env.NAME; a missing variable is an error.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const file = process.argv[2];
if (!file) throw new Error("Usage: npm run sql -- <file.sql>");
const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is not set");

function substitute(text: string): string {
  return text.replace(/__([A-Z][A-Z0-9_]*)__/g, (_match, name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set (placeholder __${name}__ in ${file})`);
    return value;
  });
}

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

async function main() {
  const text = substitute(readFileSync(file, "utf8"));
  // The simple query protocol allows several statements, including DO blocks, in one call.
  await sql.unsafe(text).simple();
  console.log("ok");
}

main()
  .catch((error: unknown) => {
    // Print only the message: the error object can carry the query text with substituted secrets.
    console.error(error instanceof Error ? error.message : "SQL failed");
    process.exitCode = 1;
  })
  .finally(() => sql.end());
