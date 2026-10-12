-- Views, run as postgres: npm run sql -- scripts/sql/004_views.sql
-- security_invoker makes the views read the tables as the caller (rs_app, the table owner).

create or replace view research_signal.latest_signals
with (security_invoker = true) as
select distinct on (s.paper_id) s.*
from research_signal.signals s
order by s.paper_id, s.captured_at desc;

-- Rung: the first matching rule wins (PEER, MODEL, CODE, LAB).
-- Rising: upvotes up >= 30% and >= 10 versus the newest snapshot at least 7 days old.
create or replace view research_signal.evidence
with (security_invoker = true) as
select
  p.id as paper_id,
  ls.captured_at,
  ls.hf_upvotes,
  ls.hf_comments,
  ls.github_repo,
  ls.github_stars,
  ls.linked_models,
  ls.linked_spaces,
  ls.or_venue,
  ls.or_decision,
  ls.s2_citations,
  ls.builds_on,
  ls.venue,
  (case
    when ls.or_venue ~* '(accepted|oral|poster|spotlight)'
      or (ls.or_decision is not null and ls.or_decision !~* '(submitted|withdrawn)')
      or p.source in ('acl', 'cvf', 'pmlr')
      or (nullif(btrim(ls.venue), '') is not null and ls.venue !~* '^arxiv')
      then 'PEER'
    when coalesce(ls.linked_models, 0) + coalesce(ls.linked_spaces, 0) > 0 then 'MODEL'
    when nullif(btrim(ls.github_repo), '') is not null then 'CODE'
    else 'LAB'
  end)::research_signal.rung as rung,
  coalesce(
    ls.hf_upvotes is not null
      and prev.hf_upvotes is not null
      and ls.hf_upvotes - prev.hf_upvotes >= 10
      and ls.hf_upvotes >= prev.hf_upvotes * 1.3,
    false
  ) as rising
from research_signal.papers p
left join research_signal.latest_signals ls on ls.paper_id = p.id
left join lateral (
  select s.hf_upvotes
  from research_signal.signals s
  where s.paper_id = p.id
    and s.captured_at <= now() - interval '7 days'
    and s.hf_upvotes is not null
  order by s.captured_at desc
  limit 1
) prev on true;

grant select on research_signal.latest_signals, research_signal.evidence to rs_app;
