-- One-time bootstrap, run as postgres: npm run sql -- scripts/sql/001_bootstrap.sql
-- Needs RS_APP_PASSWORD in the environment. The schema is owned by postgres; rs_app gets
-- usage and create on it, usage on extensions, and nothing else.
create extension if not exists vector with schema extensions;

do $$
begin
  if not exists (select from pg_roles where rolname = 'rs_app') then
    create role rs_app login noinherit password '__RS_APP_PASSWORD__';
  end if;
end
$$;

create schema if not exists research_signal;

grant usage, create on schema research_signal to rs_app;
grant usage on schema extensions to rs_app;

alter role rs_app set search_path = research_signal, extensions;
