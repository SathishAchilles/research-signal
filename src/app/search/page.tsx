import { asc, sql, type SQL } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/db/client";
import { actionKind, domains, rung, verdict } from "@/db/schema";
import { LlmCreditsExhausted } from "@/lib/llm/call";
import { cn } from "@/lib/utils";
import {
  MAX_SEARCH_LIMIT,
  SEARCH_SORTS,
  groupHits,
  search,
  searchFiltersSchema,
  type SearchFilters,
  type SearchHit,
  type SearchSort,
} from "@/lib/search/query";
import { CompactRow } from "@/components/brief/CompactRow";
import type { CardLike } from "@/components/brief/CardParts";
import type { ActionKind } from "@/lib/brief/types";
import type { Rung, SignalType, Verdict } from "@/lib/pipeline/rank";
import { ACTION_TEXT, AnswerRow, ResultRow, RowThumb, type AnswerView, type ResultView } from "./result-row";

type RawParams = Record<string, string | string[] | undefined>;
type Params = {
  q: string;
  domain: string;
  since: string;
  until: string;
  source: string;
  rung: string;
  verdict: string;
  action: string;
  code: string;
  client: string;
  sort: SearchSort;
};

const PAGE_SIZE = 50;
const PARAM_KEYS = ["q", "domain", "since", "until", "source", "rung", "verdict", "action", "code", "client"] as const;
const SORT_LABELS: Record<SearchSort, string> = { relevance: "Relevance", date: "Date", attention: "Attention" };
const SELECT_CLASS =
  "h-8 w-full rounded-tile border border-input bg-plate-solid px-2 text-sm [color-scheme:dark] outline-none focus-visible:border-ring focus-visible:outline-3 focus-visible:outline-solid focus-visible:outline-focus focus-visible:outline-offset-2 focus-visible:ring-3 focus-visible:ring-ring/50";
const LABEL_CLASS = "flex flex-col gap-1.5";

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function readParams(raw: RawParams): Params {
  const values = Object.fromEntries(PARAM_KEYS.map((key) => [key, first(raw[key])])) as Omit<Params, "sort">;
  const sort = first(raw.sort);
  return { ...values, sort: (SEARCH_SORTS as readonly string[]).includes(sort) ? (sort as SearchSort) : "relevance" };
}

function hrefWith(params: Params, changes: Partial<Params>): string {
  const merged = { ...params, ...changes };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value && !(key === "sort" && value === "relevance")) query.set(key, value);
  }
  const text = query.toString();
  return text ? `/search?${text}` : "/search";
}

// Facets that hybrid_search filters natively; invalid values are ignored.
function toFilters(p: Params): SearchFilters {
  const candidate = {
    domainId: p.domain ? Number(p.domain) : undefined,
    since: p.since || undefined,
    until: p.until || undefined,
    source: p.source || undefined,
    minRung: p.rung || undefined,
    verdict: p.verdict || undefined,
    action: p.client ? "CLIENT" : p.action || undefined,
    hasCode: p.code === "yes" ? true : p.code === "no" ? false : undefined,
  };
  const filters: SearchFilters = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (value === undefined) continue;
    const parsed = searchFiltersSchema.safeParse({ [key]: value });
    if (parsed.success) Object.assign(filters, parsed.data);
  }
  return filters;
}

type DetailRow = {
  id: string;
  arxiv_id: string | null;
  url_abs: string | null;
  url_pdf: string | null;
  rung: Rung | null;
  hf_upvotes: number | null;
  hf_comments: number | null;
  github_repo: string | null;
  github_stars: number | null;
  linked: number | null;
  s2_citations: number | null;
  verdict: Verdict | null;
  signal_type: SignalType | null;
  final_score: number | null;
  domain_name: string | null;
  my_action: ActionKind | null;
  client_tag: string | null;
  figure_url: string | null;
};

async function paperDetails(paperIds: string[], domainId: number | undefined): Promise<Map<string, DetailRow>> {
  if (paperIds.length === 0) return new Map();
  const ids: SQL = sql.join(
    paperIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await db.execute<DetailRow>(sql`
    select p.id, p.arxiv_id, p.url_abs, p.url_pdf, p.figure_url, e.rung, e.hf_upvotes, e.hf_comments, e.github_repo, e.github_stars,
      nullif(coalesce(e.linked_models, 0) + coalesce(e.linked_spaces, 0), 0) as linked, e.s2_citations,
      best.verdict, best.signal_type, best.final_score, best.domain_name, latest.action as my_action, latest.client_tag
    from research_signal.papers p
    left join research_signal.evidence e on e.paper_id = p.id
    left join lateral (
      select pd.verdict, pd.signal_type, pd.final_score, d.name as domain_name
      from research_signal.paper_domain pd
      join research_signal.domains d on d.id = pd.domain_id
      where pd.paper_id = p.id and (${domainId ?? null}::int is null or pd.domain_id = ${domainId ?? null}::int)
      order by pd.final_score desc nulls last, pd.cosine desc nulls last
      limit 1
    ) best on true
    left join lateral (
      select a.action, a.client_tag
      from research_signal.actions a
      where a.paper_id = p.id
      order by a.created_at desc, a.id desc
      limit 1
    ) latest on true
    where p.id in (${ids})`);
  return new Map(rows.map((r) => [r.id, r]));
}

// Answer docs are keyed by the assistant message id; the thread is what /ask opens.
async function answerThreads(messageIds: string[]): Promise<Map<string, string>> {
  const valid = messageIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (valid.length === 0) return new Map();
  const ids: SQL = sql.join(
    valid.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await db.execute<{ id: string; thread_id: string }>(sql`
    select m.id, m.thread_id from research_signal.ask_messages m where m.id in (${ids})`);
  return new Map(rows.map((r) => [r.id, r.thread_id]));
}

function githubUrl(repo: string | null): string | null {
  const value = repo?.trim();
  if (!value) return null;
  return /^https?:\/\//.test(value) ? value : `https://github.com/${value.replace(/^github\.com\//, "")}`;
}

const num = (v: number | string | null) => (v === null ? null : Number(v));

// Scored papers render as the brief's CompactRow; everything else falls back to a plain row.
function toCard(hit: SearchHit, d: DetailRow | undefined): CardLike | null {
  if (!hit.paperId || !d?.verdict || !d.signal_type) return null;
  return {
    paperId: hit.paperId,
    title: hit.title,
    verdict: d.verdict,
    rung: d.rung ?? "LAB",
    signalType: d.signal_type,
    links: {
      abs: d.url_abs,
      pdf: d.url_pdf,
      code: githubUrl(d.github_repo),
      hf: d.arxiv_id && d.hf_upvotes !== null ? `https://huggingface.co/papers/${d.arxiv_id}` : null,
    },
    evidence: {
      hf_upvotes: num(d.hf_upvotes),
      hf_comments: num(d.hf_comments),
      github_stars: num(d.github_stars),
      linked: num(d.linked),
      s2_citations: num(d.s2_citations),
      final_score: num(d.final_score),
    },
  };
}

function toView(hit: SearchHit, detail: DetailRow | undefined): ResultView {
  return {
    id: hit.id,
    entityType: hit.entityType,
    paperId: hit.paperId,
    title: hit.title,
    publishedAt: hit.publishedAt,
    attention: hit.attention,
    rung: detail?.rung ?? null,
    verdict: detail?.verdict ?? null,
    domain: detail?.domain_name ?? null,
    myAction: detail?.my_action ?? null,
    clientTag: detail?.client_tag ?? null,
    hfUpvotes: detail?.hf_upvotes ?? null,
    githubStars: detail?.github_stars ?? null,
    urlAbs: detail?.url_abs ?? null,
    figureUrl: detail?.figure_url ?? null,
    signalType: detail?.signal_type ?? null,
  };
}

async function facetOptions() {
  const [domainRows, sourceRows, tagRows] = await Promise.all([
    db.select({ id: domains.id, name: domains.name }).from(domains).orderBy(asc(domains.name)),
    db.execute<{ source: string }>(sql`
      select distinct source from research_signal.search_docs where source is not null order by 1`),
    db.execute<{ tag: string }>(sql`
      select distinct client_tag as tag from research_signal.actions
      where client_tag is not null and btrim(client_tag) <> '' order by 1`),
  ]);
  return { domains: domainRows, sources: sourceRows.map((r) => r.source), tags: tagRows.map((r) => r.tag) };
}

async function Results({ params }: { params: Params }) {
  const filters = toFilters(params);
  // The client tag is not a search_docs facet, and one paper can match as several docs (paper, summary,
  // note), so over-fetch and filter or collapse here.
  let hits: SearchHit[];
  try {
    hits = await search({ q: params.q, filters, sort: params.sort, limit: MAX_SEARCH_LIMIT });
  } catch (error) {
    if (!(error instanceof LlmCreditsExhausted)) throw error;
    return (
      <p role="alert" className="plate px-4 py-6 text-sm text-destructive">
        Search is unavailable: the LLM credits are exhausted, so the query cannot be embedded. Clear the query
        to browse with filters.
      </p>
    );
  }
  // Answers whose message row is gone would link nowhere, so they are dropped before grouping.
  const threads = await answerThreads(hits.filter((h) => h.entityType === "answer").map((h) => h.entityId));
  const grouped = groupHits(hits.filter((h) => h.entityType !== "answer" || threads.has(h.entityId)));
  const details = await paperDetails(
    grouped.papers.map((h) => h.paperId!),
    filters.domainId,
  );

  const tag = params.client.toLowerCase();
  const papers = grouped.papers
    .map((hit) => {
      const detail = details.get(hit.paperId!);
      return { view: toView(hit, detail), card: toCard(hit, detail), action: detail?.my_action ?? null };
    })
    // search_docs.verdict is the paper's best verdict across domains; with a domain filter the row shows that
    // domain's verdict, so keep only rows whose shown verdict matches.
    .filter(({ view }) => !params.verdict || view.verdict === params.verdict)
    .filter(({ view }) => !tag || (view.myAction === "CLIENT" && view.clientTag?.toLowerCase() === tag))
    .slice(0, PAGE_SIZE);
  // Answers and briefs carry no verdict or client tag, so those filters leave only papers.
  const paperOnly = Boolean(params.verdict || tag);
  const answers: AnswerView[] = paperOnly
    ? []
    : grouped.answers.map((hit) => ({
        id: hit.id,
        threadId: threads.get(hit.entityId)!,
        title: hit.title,
        savedAt: hit.publishedAt,
      }));
  const others = paperOnly ? [] : grouped.other.map((hit) => toView(hit, undefined));

  if (papers.length === 0 && answers.length === 0 && others.length === 0) {
    return <p className="plate px-4 py-6 text-sm text-muted-foreground">No results.</p>;
  }
  return (
    <>
      <p className="micro" aria-live="polite">
        <span className="num text-foreground">{papers.length}</span> paper{papers.length === 1 ? "" : "s"}
        {params.q ? (
          <>
            {" for "}
            <span className="normal-case tracking-normal text-foreground">&ldquo;{params.q}&rdquo;</span>
          </>
        ) : null}
      </p>
      {papers.length === 0 ? (
        <p className="plate px-4 py-6 text-sm text-muted-foreground">No papers match.</p>
      ) : (
        /* One plate holds every row; rows are divided, never glass. The CompactRow's own card
           surface is flattened into the plate (focus outline, data-card and tabIndex untouched). */
        <ul className="plate divide-y divide-border">
          {papers.map(({ view, card, action }) =>
            card ? (
              <li
                key={view.id}
                className="flex items-start gap-3 py-1 pl-4 transition-colors hover:bg-plate-hover [&_[data-card]]:min-w-0 [&_[data-card]]:flex-1 [&_[data-card]]:rounded-none [&_[data-card]]:border-0 [&_[data-card]]:bg-transparent"
              >
                <RowThumb title={view.title} figureUrl={view.figureUrl} signalType={view.signalType} />
                <CompactRow card={card} action={action}>
                  <p className="mt-0.5 text-sm text-muted-foreground lg:text-xs">
                    {[view.domain, view.publishedAt?.slice(0, 10)].filter(Boolean).join(" · ")}
                    {view.clientTag ? ` · client ${view.clientTag}` : ""}
                    {" · "}
                    <Link href={`/paper/${card.paperId}`} className="text-signal underline hover:text-foreground">
                      Open
                    </Link>
                  </p>
                </CompactRow>
              </li>
            ) : (
              <ResultRow key={view.id} hit={view} />
            ),
          )}
        </ul>
      )}
      {answers.length > 0 && (
        <section aria-labelledby="ask-answers-heading" className="mt-4 flex flex-col gap-3">
          <h2 id="ask-answers-heading" className="micro">
            From your Ask answers <span className="num text-foreground">· {answers.length}</span>
          </h2>
          <ul className="plate divide-y divide-border">
            {answers.map((answer) => (
              <AnswerRow key={answer.id} answer={answer} />
            ))}
          </ul>
        </section>
      )}
      {others.length > 0 && (
        <section aria-labelledby="other-matches-heading" className="mt-4 flex flex-col gap-3">
          <h2 id="other-matches-heading" className="micro">
            Other matches
          </h2>
          <ul className="plate divide-y divide-border">
            {others.map((view) => (
              <ResultRow key={view.id} hit={view} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Select({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className={LABEL_CLASS}>
      <span className="micro">{label}</span>
      <select name={name} defaultValue={value} className={SELECT_CLASS}>
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const asOptions = (values: readonly string[], labels: Record<string, string> = {}) =>
  values.map((v) => ({ value: v, label: labels[v] ?? v }));

// Enum values stay as stored (CLIENT); only the visible label changes.
const VERDICT_TEXT: Record<string, string> = { CLIENT: "Share with clients", READ: "Read", SKIP: "Skip" };

type FacetOptions = Awaited<ReturnType<typeof facetOptions>>;

// The filter and preset forms. Rendered once as the lg sidebar (with the query box) and once as the
// collapsible panel under the results below lg (query carried as a hidden field; the box sits above the results).
function FilterForms({ params, options, withQuery }: { params: Params; options: FacetOptions; withQuery: boolean }) {
  const domainOptions = options.domains.map((d) => ({ value: String(d.id), label: d.name }));
  const weekAgo = daysAgo(7);
  return (
    <div className="flex flex-col gap-5">
      <form action="/search" className="flex flex-col gap-3">
        {withQuery ? (
          <Input name="q" defaultValue={params.q} placeholder="Search" aria-label="Search query" />
        ) : (
          params.q && <input type="hidden" name="q" value={params.q} />
        )}
        <Select name="domain" label="Domain" value={params.domain} options={domainOptions} />
        <div className="grid grid-cols-2 gap-2">
          <label className={LABEL_CLASS}>
            <span className="micro">From</span>
            <Input type="date" name="since" defaultValue={params.since} />
          </label>
          <label className={LABEL_CLASS}>
            <span className="micro">To</span>
            <Input type="date" name="until" defaultValue={params.until} />
          </label>
        </div>
        <Select name="source" label="Source" value={params.source} options={asOptions(options.sources)} />
        <Select name="rung" label="Minimum rung" value={params.rung} options={asOptions(rung.enumValues)} />
        <Select name="verdict" label="Verdict" value={params.verdict} options={asOptions(verdict.enumValues, VERDICT_TEXT)} />
        <Select name="action" label="My action" value={params.action} options={asOptions(actionKind.enumValues, ACTION_TEXT)} />
        <Select
          name="code"
          label="Has code"
          value={params.code}
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
        />
        {params.client && <input type="hidden" name="client" value={params.client} />}
        <input type="hidden" name="sort" value={params.sort} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" className="touch:h-11">
            Apply
          </Button>
          <Link href="/search" className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "touch:h-11")}>
            Reset
          </Link>
        </div>
      </form>

      <div className="flex flex-col gap-3 border-t border-rule/40 pt-4">
        <h3 className="micro">Presets</h3>
        <form action="/search" className="flex flex-col gap-2 text-sm">
          <span>What&apos;s new in</span>
          <select
            name="domain"
            aria-label="Domain"
            defaultValue={params.domain || domainOptions[0]?.value}
            className={SELECT_CLASS}
            required
          >
            {domainOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span>since</span>
          <Input type="date" name="since" aria-label="Since" defaultValue={params.since || weekAgo} required />
          <input type="hidden" name="sort" value="attention" />
          <Button type="submit" size="sm" variant="outline" className="touch:h-11">
            Show
          </Button>
        </form>
        <form action="/search" className="flex flex-col gap-2 text-sm">
          <span>Flagged for client</span>
          {options.tags.length > 0 ? (
            <select
              name="client"
              aria-label="Client tag"
              defaultValue={params.client || options.tags[0]}
              className={SELECT_CLASS}
              required
            >
              {options.tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : (
            <Input name="client" placeholder="Client tag" aria-label="Client tag" required />
          )}
          <input type="hidden" name="sort" value="attention" />
          <Button type="submit" size="sm" variant="outline" className="touch:h-11">
            Show
          </Button>
        </form>
      </div>
    </div>
  );
}

async function SearchView({ searchParams }: { searchParams: Promise<RawParams> }) {
  await connection();
  const params = readParams(await searchParams);
  const options = await facetOptions();
  const activeFilters = PARAM_KEYS.filter((key) => key !== "q" && params[key]).length;
  const carried = PARAM_KEYS.filter((key) => key !== "q" && params[key]);

  // DOM order is the reading order at each width: the lg sidebar precedes the results, and below lg the
  // results come first and the Filters panel follows them. Only one of the two panels is ever displayed.
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[15rem_1fr]">
      <aside aria-label="Search filters" className="glass-base p-4 max-lg:hidden">
        <h2 className="micro mb-4">Filters</h2>
        <FilterForms params={params} options={options} withQuery />
      </aside>

      <section className="flex min-w-0 flex-col gap-3">
        <form action="/search" role="search" className="flex gap-2 lg:hidden">
          <Input
            name="q"
            defaultValue={params.q}
            placeholder="Search papers"
            aria-label="Search query"
            className="min-w-0 flex-1 touch:h-11"
          />
          {carried.map((key) => (
            <input key={key} type="hidden" name={key} value={params[key]} />
          ))}
          {params.sort !== "relevance" && <input type="hidden" name="sort" value={params.sort} />}
          <Button type="submit" className="touch:h-11">
            Search
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          <span className="micro" aria-hidden>
            Sort
          </span>
          <nav aria-label="Sort" className="glass-chip flex w-fit gap-1 p-1">
            {SEARCH_SORTS.map((sort) => (
              <Link
                key={sort}
                href={hrefWith(params, { sort })}
                aria-current={params.sort === sort ? "page" : undefined}
                className={cn(
                  "glass-interactive rounded-full px-3 py-1 text-sm font-medium text-muted-foreground hover:text-foreground touch:inline-flex touch:min-h-11 touch:items-center touch:px-4",
                  params.sort === sort && "bg-signal/15 text-foreground ring-1 ring-signal/50",
                )}
              >
                {SORT_LABELS[sort]}
              </Link>
            ))}
          </nav>
          {activeFilters > 0 && (
            <a href="#search-filters-panel" className="micro text-signal hover:text-foreground lg:hidden touch:inline-flex touch:min-h-11 touch:items-center">
              <span className="num">{activeFilters}</span> filter{activeFilters === 1 ? "" : "s"} on ↓
            </a>
          )}
        </div>
        {params.client && (
          <p className="text-sm text-muted-foreground">
            Flagged for client <span className="font-medium text-foreground">{params.client}</span>
          </p>
        )}
        <Suspense
          key={hrefWith(params, {})}
          fallback={<p className="plate px-4 py-6 text-sm text-muted-foreground">Searching…</p>}
        >
          <Results params={params} />
        </Suspense>
      </section>

      <aside id="search-filters-panel" aria-label="Search filters" className="glass-base scroll-mt-24 p-4 lg:hidden">
        <details className="group/filters">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span className="micro">
              Filters
              {activeFilters ? <span className="num text-foreground"> · {activeFilters} on</span> : null}
            </span>
            <svg
              viewBox="0 0 16 16"
              className="size-4 transition-transform group-open/filters:rotate-180"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="pt-4">
            <FilterForms params={params} options={options} withQuery={false} />
          </div>
        </details>
      </aside>
    </div>
  );
}

export default function SearchPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <Link href="/ask" className="micro w-fit hover:text-signal touch:inline-flex touch:min-h-11 touch:items-center">
          ← Back to Ask
        </Link>
        <p className="micro">Research-signal · Library</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Paper <span className="text-signal-2">search</span>
        </h1>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <SearchView searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
