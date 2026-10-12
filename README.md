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

Requirements: Node.js 20+ and a Supabase project with `pg_cron`, `pg_net` and `vector` available.

1. Install dependencies and create the local env file, then fill in the values (each one is described in `.env.example`):

   ```sh
   npm install
   cp .env.example .env.local
   ```

Steps 2 to 4 run the SQL files in `scripts/sql/` in this order. `npm run sql -- <file>` connects with `DATABASE_ADMIN_URL`, which is the `postgres` role. The files that `rs_app` must run (because it owns the tables) set `DATABASE_ADMIN_URL="$DATABASE_MIGRATION_URL"` for that one command. That override reads the URL from your shell, so first run `export DATABASE_MIGRATION_URL=<the rs_app session-pooler URL from .env.local>`. A variable that is already set in the shell takes precedence over `--env-file`. Each file's header names the role that runs it. `npm run sql -- scripts/sql/000_ping.sql` (`select 1`) checks the admin connection first; it prints `ok`.

2. Bootstrap the schema and the `rs_app` role, as `postgres`, passing the role's password inline:

   ```sh
   RS_APP_PASSWORD=<password> npm run sql -- scripts/sql/001_bootstrap.sql
   ```

3. Create the tables from `drizzle/`, as `rs_app`:

   ```sh
   npm run db:migrate
   ```

4. Apply the remaining SQL files in order:

   ```sh
   DATABASE_ADMIN_URL="$DATABASE_MIGRATION_URL" npm run sql -- scripts/sql/002_indexes_rls.sql      # rs_app: indexes, RLS
   npm run sql -- scripts/sql/003_functions.sql                                                     # postgres: hybrid_search and helpers
   npm run sql -- scripts/sql/004_views.sql                                                         # postgres: latest_signals, evidence
   DATABASE_ADMIN_URL="$DATABASE_MIGRATION_URL" npm run sql -- scripts/sql/006_jobs_dedupe.sql      # rs_app: one PENDING job per stage
   DATABASE_ADMIN_URL="$DATABASE_MIGRATION_URL" npm run sql -- scripts/sql/007_search_verdict.sql   # rs_app half first
   npm run sql -- scripts/sql/007_search_verdict.sql                                                # then the postgres half
   DATABASE_ADMIN_URL="$DATABASE_MIGRATION_URL" npm run sql -- scripts/sql/008_paper_figures.sql    # rs_app: paper figures, figures stage
   DATABASE_ADMIN_URL="$DATABASE_MIGRATION_URL" npm run sql -- scripts/sql/009_llm_call_request.sql # rs_app: per-request Ask cost
   ```

   `005_cron.sql` is applied last, in step 9, after the deploy.

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

9. After the production deploy answers `/api/health` with OK, schedule the pipeline as `postgres`. `scripts/sql/005_cron.sql` stores `CRON_SECRET` in Vault as `rs_cron_secret`, creates the `research_signal.call_stage(name)` helper (a `pg_net` POST to `$APP_URL/api/stage/<name>` with the `x-cron-secret` header) and schedules six jobs: `rs_ingest`, `rs_drain`, `rs_hf_refresh`, `rs_weekly`, `rs_weekly_retry` and `rs_retention`. It is safe to re-run, and it leaves other apps' cron jobs alone. Use the same `CRON_SECRET` that is set in Vercel:

   ```sh
   CRON_SECRET=<secret> APP_URL=https://research-signal.vercel.app npm run sql -- scripts/sql/005_cron.sql
   ```

   Check it with `select jobname, schedule from cron.job where jobname like 'rs\_%';`, which should return six rows.

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
