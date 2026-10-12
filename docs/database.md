# Database

research-signal uses the hosted Supabase project that trip-together, aangan and kargo-hiring already use (region ap-southeast-1, Postgres 17). Each app has its own schema; research-signal never touches the others.

## Schema and role

| Item | Value |
|---|---|
| App schema | `research_signal`, owned by `postgres` |
| Role | `rs_app` (login, `noinherit`, default `search_path = research_signal, extensions`) |
| Privileges | `usage, create` on `research_signal`; `usage` on `extensions`; execute on the three `research_signal.*` functions; nothing else |
| Extension | `vector` 0.8 in schema `extensions` (shared with the other apps) |
| Migrations table | `research_signal.__migrations` (not the shared `drizzle` schema) |
| Vault secrets | names prefixed `rs_` (`rs_cron_secret`, `rs_src_<source>`) |

Tables are created and owned by `rs_app` through migrations. Every table has row-level security enabled with no policies, so the Supabase REST roles (`anon`, `authenticated`) can read nothing; only the server, connecting as `rs_app`, can. As `rs_app`, the schemas `trip_together`, `aangan`, `kargo_hiring`, `auth` and `vault` have no `usage` privilege.

## Connections

| Variable | Pooler | Port | User | Used by |
|---|---|---|---|---|
| `DATABASE_URL` | transaction (Supavisor) | 6543 | `rs_app.<project-ref>` | the app at runtime; `postgres-js` with `prepare: false`, max 5 |
| `DATABASE_MIGRATION_URL` | session (Supavisor) | 5432 | `rs_app.<project-ref>` | `npm run db:migrate`, `npm run seed`, `psql` |
| `DATABASE_ADMIN_URL` | session (Supavisor) | 5432 | `postgres.<project-ref>` | `npm run sql` (one-time admin steps only) |

Values live in `.env.local` and Vercel environment variables only. `DATABASE_ADMIN_URL` is never set on Vercel.

## Bootstrap order

Run these once, in order, from the repo root.

1. Extension, role and schema, as `postgres`. Generate a password and keep it for the two `rs_app` URLs above:

   ```sh
   export RS_APP_PASSWORD=$(openssl rand -hex 24)
   npm run sql -- scripts/sql/001_bootstrap.sql
   ```

2. Tables, as `rs_app`. This runs `scripts/migrate.ts`, which applies each new `drizzle/*.sql` file in a transaction and records its SHA-256 in `research_signal.__migrations`; editing an applied file is refused.

   ```sh
   npm run db:migrate
   ```

3. Indexes and row-level security, as `rs_app` (the table owner):

   ```sh
   psql "$DATABASE_MIGRATION_URL" -f scripts/sql/002_indexes_rls.sql
   ```

4. Functions (`hybrid_search`, `set_source_secret`, `get_source_secret`), as `postgres`:

   ```sh
   npm run sql -- scripts/sql/003_functions.sql
   ```

5. Views (`latest_signals`, `evidence`), as `postgres`. Both are `security_invoker`, so they read the tables as `rs_app`:

   ```sh
   npm run sql -- scripts/sql/004_views.sql
   ```

6. Settings row, domains and sources, as `rs_app`. Re-running resets these rows to their defaults but keeps `pin_hash`:

   ```sh
   npm run seed
   ```

`npm run sql -- scripts/sql/000_ping.sql` checks the admin connection and prints `ok`.

## Migrations

- Change `src/db/schema.ts`, then `npm run db:generate -- --name <what>` to write `drizzle/NNNN_<what>.sql`.
- Apply with `npm run db:migrate`.
- `drizzle-kit migrate` is not used: it always runs `CREATE SCHEMA IF NOT EXISTS`, which needs database-level CREATE rights that `rs_app` deliberately does not have. For the same reason the generated `CREATE SCHEMA` line was removed from `drizzle/0000_init.sql`.

## Rollback

Run as `postgres` (`psql "$DATABASE_ADMIN_URL"`), in this order. The prefix checks use `starts_with` rather than `like 'rs_%'` on purpose: in `like`, `_` matches any character, which could hit another app's jobs or secrets.

```sql
-- 1. Stop all automation.
select cron.unschedule(jobname) from cron.job where starts_with(jobname, 'rs_');
-- 2. Remove the app's tables, views, functions and data.
drop schema research_signal cascade;
-- 3. Remove the app's Vault secrets (not removed by the schema drop).
delete from vault.secrets where starts_with(name, 'rs_');
-- 4. Remove the role.
drop owned by rs_app;
drop role rs_app;
```

Never drop the `vector` extension: the other apps on this project share it. None of these steps touch `trip_together`, `aangan` or `kargo_hiring`.
