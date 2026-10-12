import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["research_signal"],
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL ?? "" },
});
