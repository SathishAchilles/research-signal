-- Paper figures (D23): the lead figure with its source, and up to 6 {url, caption} entries from arXiv HTML.
-- Adds the `figures` job stage, which runs after `enrich`.
-- Run as rs_app (the owner of research_signal.papers and the job_stage type):
--   DATABASE_ADMIN_URL="$DATABASE_MIGRATION_URL" npm run sql -- scripts/sql/008_paper_figures.sql
set search_path = research_signal, extensions;

alter table research_signal.papers
  add column if not exists figure_url text,
  add column if not exists figure_source text,
  add column if not exists figures jsonb;

do $$
begin
  if not exists (select from pg_constraint where conname = 'papers_figure_source_check') then
    alter table research_signal.papers
      add constraint papers_figure_source_check
      check (figure_source is null or figure_source in ('hf_media', 'arxiv_html', 'hf_thumb'));
  end if;
end $$;

alter type research_signal.job_stage add value if not exists 'figures' after 'enrich';
