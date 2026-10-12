-- Indexes and row-level security, run as rs_app (the table owner):
--   psql "$DATABASE_MIGRATION_URL" -f scripts/sql/002_indexes_rls.sql
set search_path = research_signal, extensions;

create index if not exists papers_fts_idx on research_signal.papers using gin (fts);
create index if not exists search_docs_fts_idx on research_signal.search_docs using gin (fts);
create index if not exists search_docs_domain_ids_idx on research_signal.search_docs using gin (domain_ids);

create index if not exists papers_embedding_idx on research_signal.papers using hnsw (embedding halfvec_ip_ops);
create index if not exists search_docs_embedding_idx on research_signal.search_docs using hnsw (embedding halfvec_ip_ops);

create index if not exists papers_status_idx on research_signal.papers (status);
create index if not exists papers_announced_at_idx on research_signal.papers (announced_at);
create index if not exists signals_paper_captured_idx on research_signal.signals (paper_id, captured_at desc);
create index if not exists jobs_status_run_after_idx on research_signal.jobs (status, run_after);

-- RLS on with no policies: the Supabase REST roles can read nothing; only rs_app (the owner) can.
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'research_signal' loop
    execute format('alter table research_signal.%I enable row level security', t.tablename);
  end loop;
end
$$;
