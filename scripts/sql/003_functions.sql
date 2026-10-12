-- Functions, run as postgres: npm run sql -- scripts/sql/003_functions.sql

-- Hybrid full-text + semantic search over search_docs, fused with reciprocal rank fusion.
-- Security invoker: it reads the tables as the caller (rs_app).
-- filters keys: domainId, since, until, source, minRung, action, hasCode, sort ('attention' | 'published').
create or replace function research_signal.hybrid_search(
  q text,
  q_emb extensions.halfvec(768),
  filters jsonb,
  match_count int,
  rrf_k int default 50
)
returns table (
  id bigint,
  entity_type research_signal.entity_type,
  entity_id text,
  paper_id uuid,
  title text,
  published_at timestamptz,
  attention real,
  score double precision
)
language plpgsql
set search_path = research_signal, extensions
as $$
#variable_conflict use_column
declare
  f jsonb := coalesce(filters, '{}'::jsonb);
begin
  set local hnsw.iterative_scan = relaxed_order;

  if q is null or btrim(q) = '' then
    return query
    select d.id, d.entity_type, d.entity_id, d.paper_id, d.title, d.published_at, d.attention,
      0::double precision as score
    from research_signal.search_docs d
    where (f->>'domainId' is null or (f->>'domainId')::int = any(d.domain_ids))
      and (f->>'since' is null or d.published_at >= (f->>'since')::timestamptz)
      and (f->>'until' is null or d.published_at <= (f->>'until')::timestamptz)
      and (f->>'source' is null or d.source = f->>'source')
      and (f->>'minRung' is null or d.rung >= (f->>'minRung')::research_signal.rung)
      and (f->>'action' is null or d.user_action = (f->>'action')::research_signal.action_kind)
      and (f->>'hasCode' is null or d.has_code = (f->>'hasCode')::boolean)
    order by
      case when f->>'sort' = 'attention' then d.attention end desc nulls last,
      d.published_at desc nulls last
    limit match_count;
    return;
  end if;

  return query
  with full_text as (
    select d.id,
      row_number() over (
        order by ts_rank_cd(d.fts, websearch_to_tsquery('english', q)) desc
      ) as rank_ix
    from research_signal.search_docs d
    where d.fts @@ websearch_to_tsquery('english', q)
      and (f->>'domainId' is null or (f->>'domainId')::int = any(d.domain_ids))
      and (f->>'since' is null or d.published_at >= (f->>'since')::timestamptz)
      and (f->>'until' is null or d.published_at <= (f->>'until')::timestamptz)
      and (f->>'source' is null or d.source = f->>'source')
      and (f->>'minRung' is null or d.rung >= (f->>'minRung')::research_signal.rung)
      and (f->>'action' is null or d.user_action = (f->>'action')::research_signal.action_kind)
      and (f->>'hasCode' is null or d.has_code = (f->>'hasCode')::boolean)
    order by rank_ix
    limit match_count * 2
  ),
  semantic as (
    select d.id,
      row_number() over (order by d.embedding <#> q_emb) as rank_ix
    from research_signal.search_docs d
    where q_emb is not null
      and d.embedding is not null
      and (f->>'domainId' is null or (f->>'domainId')::int = any(d.domain_ids))
      and (f->>'since' is null or d.published_at >= (f->>'since')::timestamptz)
      and (f->>'until' is null or d.published_at <= (f->>'until')::timestamptz)
      and (f->>'source' is null or d.source = f->>'source')
      and (f->>'minRung' is null or d.rung >= (f->>'minRung')::research_signal.rung)
      and (f->>'action' is null or d.user_action = (f->>'action')::research_signal.action_kind)
      and (f->>'hasCode' is null or d.has_code = (f->>'hasCode')::boolean)
    order by rank_ix
    limit match_count * 2
  )
  select d.id, d.entity_type, d.entity_id, d.paper_id, d.title, d.published_at, d.attention,
    (coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0)
      + coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0))::double precision as score
  from full_text
  full outer join semantic on full_text.id = semantic.id
  join research_signal.search_docs d on d.id = coalesce(full_text.id, semantic.id)
  order by 8 desc
  limit match_count;
end;
$$;

-- Source API keys live in Supabase Vault under the prefix rs_src_.
create or replace function research_signal.set_source_secret(name text, value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  full_name text := 'rs_src_' || set_source_secret.name;
  existing uuid;
begin
  if set_source_secret.name !~ '^[a-z0-9_]+$' then
    raise exception 'invalid secret name';
  end if;
  select s.id into existing from vault.secrets s where s.name = full_name;
  if existing is null then
    perform vault.create_secret(set_source_secret.value, full_name);
  else
    perform vault.update_secret(existing, set_source_secret.value);
  end if;
end;
$$;

create or replace function research_signal.get_source_secret(name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  select ds.decrypted_secret into secret
  from vault.decrypted_secrets ds
  where ds.name = 'rs_src_' || get_source_secret.name;
  return secret;
end;
$$;

revoke all on function research_signal.hybrid_search(text, extensions.halfvec, jsonb, int, int) from public;
revoke all on function research_signal.set_source_secret(text, text) from public;
revoke all on function research_signal.get_source_secret(text) from public;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on function research_signal.hybrid_search(text, extensions.halfvec, jsonb, int, int) from %I', r);
      execute format('revoke all on function research_signal.set_source_secret(text, text) from %I', r);
      execute format('revoke all on function research_signal.get_source_secret(text) from %I', r);
    end if;
  end loop;
end
$$;

grant execute on function research_signal.hybrid_search(text, extensions.halfvec, jsonb, int, int) to rs_app;
grant execute on function research_signal.set_source_secret(text, text) to rs_app;
grant execute on function research_signal.get_source_secret(text) to rs_app;
