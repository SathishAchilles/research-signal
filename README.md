# research-signal

Weekly AI/ML research brief for a technology-strategy consultant: scans monitored domains across arXiv, OpenReview, Hugging Face Papers, Semantic Scholar and ACL/CVF/PMLR, ranks what is significant and validated, and delivers a domain-organised brief every Monday 07:00 IST that reads in under ten minutes. Includes hybrid search and an agentic Ask panel over everything indexed.

- Live app: <https://research-signal.vercel.app> (PIN-gated)
- Repository: <https://github.com/SathishAchilles/research-signal>
- Components map: [docs/components-map.md](docs/components-map.md)

## Stack

- **App:** Next.js 16 (App Router) and React 19 on Vercel (region `sin1`); Tailwind CSS 4 with shadcn/Base UI components. A push to `main` deploys to production.
- **Data:** Supabase Postgres with pgvector, in the `research_signal` schema of a shared project; Drizzle ORM over `postgres.js`; full-text plus `halfvec(768)` HNSW hybrid search.
- **Scheduling:** Supabase `pg_cron` + `pg_net` call the `/api/stage/*` routes; a Vercel Cron heartbeat drains the queue if it goes idle.
- **AI:** Gemini (Flash and embeddings) through OpenRouter via the Vercel AI SDK.
- **Email:** Resend, scheduled for Monday 07:00 IST.
- **Auth:** a single 6-digit PIN stored as an argon2id hash; sessions are signed JWTs (`jose`).

## Setup

Requirements: Node.js 20+, `psql`, and a Supabase project with `pg_cron`, `pg_net` and `vector` available.

1. Install dependencies and create the local env file, then fill in the values (each one is described in `.env.example`):

   ```sh
   npm install
   cp .env.example .env.local
   ```

2. Bootstrap the schema and the `rs_app` role, as `postgres` (needs `DATABASE_ADMIN_URL`; pass the role's password inline):

   ```sh
   RS_APP_PASSWORD=<password> npm run sql -- scripts/sql/001_bootstrap.sql
   ```

3. Create the tables from `drizzle/`, as `rs_app`:

   ```sh
   npm run db:migrate
   ```

4. Indexes and row-level security, as `rs_app` (the table owner), then functions and views as `postgres`:

   ```sh
   psql "$DATABASE_MIGRATION_URL" -f scripts/sql/002_indexes_rls.sql
   npm run sql -- scripts/sql/003_functions.sql
   npm run sql -- scripts/sql/004_views.sql
   ```

5. Seed the settings row, the starting domains and the sources (re-running resets them to the defaults but keeps the PIN hash and run state):

   ```sh
   npm run seed
   ```

6. Set the PIN. Run this in a real interactive terminal: it reads the PIN with hidden input and refuses to run without a TTY.

   ```sh
   npm run set-pin
   ```

7. Backfill the last two weeks and compose a preview brief (it is not sent):

   ```sh
   npm run backfill -- --weeks 2
   ```

8. Run the app locally with `npm run dev`, or deploy by pushing to `main`.

9. After the production deploy answers `/api/health` with OK, create the six `rs_*` cron jobs with `scripts/sql/005_cron.sql` (created in task 12.5), as `postgres`:

   ```sh
   CRON_SECRET=<secret> APP_URL=https://research-signal.vercel.app npm run sql -- scripts/sql/005_cron.sql
   ```

More detail on roles, grants and each SQL file is in [docs/database.md](docs/database.md).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a Drizzle migration from `src/db/schema.ts` changes |
| `npm run db:migrate` | Apply `drizzle/*.sql` in order as `rs_app` |
| `npm run sql -- <file>` | Run one SQL file as `postgres`, substituting `__NAME__` placeholders from the environment |
| `npm run seed` | Upsert settings, domains and sources |
| `npm run set-pin` | Store the 6-digit PIN as an argon2id hash (interactive terminal only) |
| `npm run backfill -- --weeks N` | Load and process the last N weeks (1-8) and compose a preview brief |
| `npm run smoke -- <name>` | Run a smoke check from `scripts/smoke/` |

## Docs

- [Components map](docs/components-map.md), with the [architecture](docs/diagrams/architecture.png) and [user flow](docs/diagrams/user-flow.png) diagrams
- [Database](docs/database.md) · [Ranking](docs/ranking.md) · [Brief](docs/brief.md) · [Ask](docs/ask.md)

Design and plan: `~/ws/openspec/changes/research-signal/`.
