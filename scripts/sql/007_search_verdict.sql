-- Search facets for suggested verdict, attention and rung, plus a similarity column from hybrid_search.
-- Two halves, each run only by the role that owns its objects. Run the rs_app half first, because the new
-- hybrid_search reads search_docs.verdict:
--   DATABASE_ADMIN_URL="$DATABASE_MIGRATION_URL" npm run sql -- scripts/sql/007_search_verdict.sql   (rs_app)
--   npm run sql -- scripts/sql/007_search_verdict.sql                                               (postgres)
-- Both halves are idempotent.

-- rs_app half: the column, facet maintenance and the backfill.
do $rs_app$
declare
  r text;
begin
  if current_user <> 'rs_app' then
    raise notice 'skipping the rs_app half as %', current_user;
    return;
  end if;

  alter table research_signal.search_docs add column if not exists verdict research_signal.verdict;
  create index if not exists search_docs_paper_id_idx on research_signal.search_docs (paper_id);

  -- Paper facets shared by every doc tied to a paper. attention mirrors scoreComponents().attention in
  -- src/lib/pipeline/rank.ts and is null until the paper has a signals snapshot. verdict is the paper's
  -- best domain row, ordered as the search page orders it.
  create or replace function research_signal.paper_search_facets(ids uuid[])
  returns table (
    paper_id uuid,
    rung research_signal.rung,
    attention real,
    has_code boolean,
    verdict research_signal.verdict
  )
  language sql
  stable
  set search_path = research_signal, extensions
  as $fn$
    select e.paper_id,
      e.rung,
      case when e.captured_at is null then null else (
        0.5 * least(1, log(1 + greatest(0, coalesce(e.hf_upvotes, 0))) / 2.5)
        + 0.3 * least(1, log(1 + greatest(0, coalesce(e.github_stars, 0))) / 4)
        + 0.2 * least(1, greatest(0, coalesce(e.linked_models, 0) + coalesce(e.linked_spaces, 0)) / 5.0)
      )::real end,
      nullif(btrim(e.github_repo), '') is not null,
      (select pd.verdict
       from research_signal.paper_domain pd
       where pd.paper_id = e.paper_id
       order by pd.final_score desc nulls last, pd.cosine desc nulls last
       limit 1)
    from research_signal.evidence e
    where e.paper_id = any(ids)
  $fn$;

  create or replace function research_signal.refresh_search_facets(ids uuid[])
  returns int
  language sql
  set search_path = research_signal, extensions
  as $fn$
    with changed as (
      update research_signal.search_docs d
      set rung = f.rung, attention = f.attention, has_code = f.has_code, verdict = f.verdict
      from research_signal.paper_search_facets(ids) f
      where d.paper_id = f.paper_id
        and (d.rung, d.attention, d.has_code, d.verdict)
          is distinct from (f.rung, f.attention, f.has_code, f.verdict)
      returning 1
    )
    select count(*)::int from changed
  $fn$;

  -- A new doc tied to a paper starts with the paper's current facets; explicit values win.
  create or replace function research_signal.search_docs_fill_facets()
  returns trigger
  language plpgsql
  set search_path = research_signal, extensions
  as $fn$
  declare
    f record;
  begin
    if new.paper_id is null then
      return new;
    end if;
    select * into f from research_signal.paper_search_facets(array[new.paper_id]);
    if found then
      new.rung := coalesce(new.rung, f.rung);
      new.attention := coalesce(new.attention, f.attention);
      new.has_code := coalesce(new.has_code, false) or coalesce(f.has_code, false);
      new.verdict := coalesce(new.verdict, f.verdict);
    end if;
    return new;
  end;
  $fn$;

  -- Statement triggers: rankAll rewrites verdicts and the source stages insert signals snapshots.
  create or replace function research_signal.search_facets_from_new_rows()
  returns trigger
  language plpgsql
  set search_path = research_signal, extensions
  as $fn$
  begin
    perform research_signal.refresh_search_facets(array(select distinct n.paper_id from new_rows n));
    return null;
  end;
  $fn$;

  create or replace function research_signal.search_facets_from_old_rows()
  returns trigger
  language plpgsql
  set search_path = research_signal, extensions
  as $fn$
  begin
    perform research_signal.refresh_search_facets(array(select distinct o.paper_id from old_rows o));
    return null;
  end;
  $fn$;

  create or replace function research_signal.search_facets_from_ranked_rows()
  returns trigger
  language plpgsql
  set search_path = research_signal, extensions
  as $fn$
  begin
    perform research_signal.refresh_search_facets(array(
      select distinct n.paper_id
      from new_rows n
      join old_rows o on o.paper_id = n.paper_id and o.domain_id = n.domain_id
      where (n.verdict, n.final_score, n.cosine) is distinct from (o.verdict, o.final_score, o.cosine)
    ));
    return null;
  end;
  $fn$;

  revoke all on function research_signal.paper_search_facets(uuid[]) from public;
  revoke all on function research_signal.refresh_search_facets(uuid[]) from public;
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on function research_signal.paper_search_facets(uuid[]) from %I', r);
      execute format('revoke all on function research_signal.refresh_search_facets(uuid[]) from %I', r);
    end if;
  end loop;

  drop trigger if exists search_docs_fill_facets on research_signal.search_docs;
  create trigger search_docs_fill_facets
    before insert on research_signal.search_docs
    for each row execute function research_signal.search_docs_fill_facets();

  drop trigger if exists search_facets_on_signals_insert on research_signal.signals;
  create trigger search_facets_on_signals_insert
    after insert on research_signal.signals
    referencing new table as new_rows
    for each statement execute function research_signal.search_facets_from_new_rows();

  drop trigger if exists search_facets_on_signals_update on research_signal.signals;
  create trigger search_facets_on_signals_update
    after update on research_signal.signals
    referencing new table as new_rows
    for each statement execute function research_signal.search_facets_from_new_rows();

  drop trigger if exists search_facets_on_paper_domain_update on research_signal.paper_domain;
  create trigger search_facets_on_paper_domain_update
    after update on research_signal.paper_domain
    referencing old table as old_rows new table as new_rows
    for each statement execute function research_signal.search_facets_from_ranked_rows();

  drop trigger if exists search_facets_on_paper_domain_delete on research_signal.paper_domain;
  create trigger search_facets_on_paper_domain_delete
    after delete on research_signal.paper_domain
    referencing old table as old_rows
    for each statement execute function research_signal.search_facets_from_old_rows();

  -- Backfill: one summary doc per scored paper (FTS only until indexPaperSummaries embeds it), then the
  -- facets of every doc tied to a paper.
  insert into research_signal.search_docs (entity_type, entity_id, paper_id, title, body, domain_ids, source, published_at)
  select 'summary', p.id::text, p.id, p.title,
    concat_ws(E'\n', 'Signal: ' || s.signal_type::text, 'Client angle: ' || nullif(btrim(s.client_angle), '')),
    s.domain_ids, p.source, coalesce(p.announced_at, p.submitted_at)
  from research_signal.papers p
  join lateral (
    select
      (array_agg(pd.signal_type order by pd.final_score desc nulls last, pd.cosine desc nulls last))[1] as signal_type,
      (array_agg(pd.client_angle order by pd.final_score desc nulls last, pd.cosine desc nulls last))[1] as client_angle,
      array_agg(pd.domain_id order by pd.domain_id) as domain_ids
    from research_signal.paper_domain pd
    where pd.paper_id = p.id and pd.scored_at is not null and pd.signal_type is not null
  ) s on s.signal_type is not null
  on conflict (entity_type, entity_id) do nothing;

  perform research_signal.refresh_search_facets(array(
    select distinct d.paper_id from research_signal.search_docs d where d.paper_id is not null
  ));
end
$rs_app$;

-- postgres half: hybrid_search gains the 'verdict' filter key and a trailing similarity column (the cosine
-- of the hit to the query, null for full-text-only hits). Adding an output column changes the return type,
-- so the function is dropped and recreated with the same arguments and the grants from 003.
do $postgres$
declare
  r text;
begin
  if current_user <> 'postgres' then
    raise notice 'skipping the postgres half as %', current_user;
    return;
  end if;
  if not exists (
    select from information_schema.columns
    where table_schema = 'research_signal' and table_name = 'search_docs' and column_name = 'verdict'
  ) then
    raise exception 'search_docs.verdict is missing; run the rs_app half of this file first';
  end if;

  drop function if exists research_signal.hybrid_search(text, extensions.halfvec, jsonb, int, int);

  -- filters keys: domainId, since, until, source, minRung, verdict, action, hasCode,
  -- sort ('attention' | 'published').
  create function research_signal.hybrid_search(
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
    score double precision,
    similarity double precision
  )
  language plpgsql
  set search_path = research_signal, extensions
  as $fn$
  #variable_conflict use_column
  declare
    f jsonb := coalesce(filters, '{}'::jsonb);
  begin
    set local hnsw.iterative_scan = relaxed_order;

    if q is null or btrim(q) = '' then
      return query
      select d.id, d.entity_type, d.entity_id, d.paper_id, d.title, d.published_at, d.attention,
        0::double precision as score, null::double precision as similarity
      from research_signal.search_docs d
      where (f->>'domainId' is null or (f->>'domainId')::int = any(d.domain_ids))
        and (f->>'since' is null or d.published_at >= (f->>'since')::timestamptz)
        and (f->>'until' is null or d.published_at <= (f->>'until')::timestamptz)
        and (f->>'source' is null or d.source = f->>'source')
        and (f->>'minRung' is null or d.rung >= (f->>'minRung')::research_signal.rung)
        and (f->>'verdict' is null or d.verdict = (f->>'verdict')::research_signal.verdict)
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
        and (f->>'verdict' is null or d.verdict = (f->>'verdict')::research_signal.verdict)
        and (f->>'action' is null or d.user_action = (f->>'action')::research_signal.action_kind)
        and (f->>'hasCode' is null or d.has_code = (f->>'hasCode')::boolean)
      order by rank_ix
      limit match_count * 2
    ),
    semantic as (
      select d.id,
        row_number() over (order by d.embedding <#> q_emb) as rank_ix,
        (-(d.embedding <#> q_emb))::double precision as cosine
      from research_signal.search_docs d
      where q_emb is not null
        and d.embedding is not null
        and (f->>'domainId' is null or (f->>'domainId')::int = any(d.domain_ids))
        and (f->>'since' is null or d.published_at >= (f->>'since')::timestamptz)
        and (f->>'until' is null or d.published_at <= (f->>'until')::timestamptz)
        and (f->>'source' is null or d.source = f->>'source')
        and (f->>'minRung' is null or d.rung >= (f->>'minRung')::research_signal.rung)
        and (f->>'verdict' is null or d.verdict = (f->>'verdict')::research_signal.verdict)
        and (f->>'action' is null or d.user_action = (f->>'action')::research_signal.action_kind)
        and (f->>'hasCode' is null or d.has_code = (f->>'hasCode')::boolean)
      order by rank_ix
      limit match_count * 2
    )
    select d.id, d.entity_type, d.entity_id, d.paper_id, d.title, d.published_at, d.attention,
      (coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0)
        + coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0))::double precision as score,
      semantic.cosine as similarity
    from full_text
    full outer join semantic on full_text.id = semantic.id
    join research_signal.search_docs d on d.id = coalesce(full_text.id, semantic.id)
    order by 8 desc
    limit match_count;
  end;
  $fn$;

  revoke all on function research_signal.hybrid_search(text, extensions.halfvec, jsonb, int, int) from public;
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on function research_signal.hybrid_search(text, extensions.halfvec, jsonb, int, int) from %I', r);
    end if;
  end loop;
  grant execute on function research_signal.hybrid_search(text, extensions.halfvec, jsonb, int, int) to rs_app;
end
$postgres$;
