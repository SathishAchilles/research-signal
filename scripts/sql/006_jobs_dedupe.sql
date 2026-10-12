-- At most one PENDING job per stage, so enqueue can dedupe atomically with ON CONFLICT.
-- Run as rs_app (the table owner; postgres has no rights on research_signal.jobs):
--   DATABASE_ADMIN_URL="$DATABASE_MIGRATION_URL" npm run sql -- scripts/sql/006_jobs_dedupe.sql
set search_path = research_signal, extensions;

-- Collapse any existing duplicates first (keep the oldest waiting job per stage), or the index cannot be built.
delete from research_signal.jobs j
using research_signal.jobs keep
where j.status = 'PENDING'
  and keep.status = 'PENDING'
  and keep.stage = j.stage
  and keep.id < j.id;

create unique index if not exists jobs_one_pending_per_stage_idx
  on research_signal.jobs (stage)
  where status = 'PENDING';
