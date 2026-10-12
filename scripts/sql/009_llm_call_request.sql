-- Per-request cost attribution for Ask: llm_calls.request_id, filled from a stage suffix.
-- A caller passes stage "<stage>#<uuid>" (for example "ask#2f0c…"); the trigger moves the uuid into
-- request_id and keeps the plain stage, so the Usage page still groups by stage.
-- Run as rs_app (the owner of research_signal.llm_calls):
--   DATABASE_ADMIN_URL="$DATABASE_MIGRATION_URL" npm run sql -- scripts/sql/009_llm_call_request.sql
set search_path = research_signal, extensions;

alter table research_signal.llm_calls add column if not exists request_id uuid;

create index if not exists llm_calls_request_id_idx
  on research_signal.llm_calls (request_id) where request_id is not null;

create or replace function research_signal.llm_calls_split_request()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parts text[];
begin
  parts := regexp_match(new.stage, '^(.+)#([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$');
  if parts is not null then
    new.stage := parts[1];
    new.request_id := parts[2]::uuid;
  end if;
  return new;
end
$$;

revoke all on function research_signal.llm_calls_split_request() from public;

drop trigger if exists llm_calls_split_request on research_signal.llm_calls;
create trigger llm_calls_split_request
  before insert on research_signal.llm_calls
  for each row execute function research_signal.llm_calls_split_request();
