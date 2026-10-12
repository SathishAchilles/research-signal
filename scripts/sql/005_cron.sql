-- Scheduling (design D4), run as postgres:
--   CRON_SECRET=... APP_URL=https://research-signal.vercel.app npm run sql -- scripts/sql/005_cron.sql
-- run-sql.ts replaces __CRON_SECRET__ and __APP_URL__ from the environment. Safe to re-run: the
-- secret is updated in place, the helper is replaced and cron.schedule updates a job with the same name.
-- Only rs_* jobs are touched; other apps' cron jobs in this database are left alone.
--
-- No rs_figures job: the figures stage is a queue job. enrich enqueues it and rs_drain runs it
-- (jobRunners.figures in src/lib/pipeline/stages.ts), so it needs no trigger of its own.

-- 1. The cron secret in Vault: created if missing, updated if present.
do $$
declare
  secret_id uuid;
begin
  select id into secret_id from vault.secrets where name = 'rs_cron_secret';
  if secret_id is null then
    perform vault.create_secret('__CRON_SECRET__', 'rs_cron_secret', 'research-signal: x-cron-secret for /api/stage/*');
  else
    perform vault.update_secret(secret_id, '__CRON_SECRET__');
  end if;
end
$$;

-- 2. POSTs to <APP_URL>/api/stage/<name> with the secret. The route answers 202 and works in after().
create or replace function research_signal.call_stage(name text)
returns bigint
language sql
set search_path = ''
as $$
  select net.http_post(
    url := '__APP_URL__/api/stage/' || call_stage.name,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'rs_cron_secret')
    ),
    timeout_milliseconds := 10000
  );
$$;

-- Only postgres (which pg_cron runs these jobs as) calls the helper.
revoke all on function research_signal.call_stage(text) from public;

-- 3. The D4 schedule, in UTC.
select cron.schedule('rs_ingest', '30 2 * * 1-5', $$select research_signal.call_stage('ingest')$$);
select cron.schedule('rs_drain', '*/3 2-7 * * 1-5', $$select research_signal.call_stage('drain')$$);
select cron.schedule('rs_hf_refresh', '0 14 * * *', $$select research_signal.call_stage('hf_refresh')$$);
select cron.schedule('rs_weekly', '0 12 * * 0', $$select research_signal.call_stage('weekly')$$);
select cron.schedule('rs_weekly_retry', '0 16 * * 0', $$select research_signal.call_stage('weekly_retry')$$);
select cron.schedule('rs_retention', '0 20 * * 6', $$select research_signal.call_stage('retention')$$);
