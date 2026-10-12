import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EvidenceMeter } from "@/components/brief/EvidenceMeter";
import { SignalChip } from "@/components/brief/SignalChip";
import { PaperFigure } from "@/components/paper/PaperFigure";
import { Badge } from "@/components/ui/badge";
import { ConeChart } from "@/components/viz/ConeChart";
import { SpecTable } from "@/components/viz/SpecTable";
import { db } from "@/db/client";
import { actions, domains, paperDomain, papers, signals } from "@/db/schema";
import { COLORS_UI } from "@/lib/brief/cues";
import type { Rung } from "@/lib/pipeline/rank";
import { PaperActions } from "./PaperActions";

// The existence check runs before anything streams, so an unknown id is a real 404.
export const instant = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELATED_K = 8;
const GALLERY_MAX = 6; // lead figure + up to 5 more
const LEAD_W = 960;
const LEAD_H = 420;
const THUMB_W = 184;
const THUMB_H = 120;
const CONE_MAX = 12;

// next/image serves only the hosts in next.config.ts images.remotePatterns; anything else is skipped.
function servable(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (u.hostname === "arxiv.org") return u.pathname.startsWith("/html/");
    return u.hostname === "cdn-uploads.huggingface.co" || u.hostname === "cdn-thumbnails.huggingface.co";
  } catch {
    return false;
  }
}

type BuildsOn = { paperId: string | null; title: string; citationCount: number | null }[];

const date = (v: Date | string | null) => (v ? new Date(v).toISOString().slice(0, 10) : "–");
// "MM-DD HHh" (UTC): hourly HF refreshes often land several snapshots on the same day.
const snapshot = (v: Date | string) => {
  const iso = new Date(v).toISOString();
  return `${iso.slice(5, 10)} ${iso.slice(11, 13)}h`;
};
const score = (v: number | null) => (v === null ? "–" : v.toFixed(2));

async function load(id: string) {
  const [paper] = await db.select().from(papers).where(eq(papers.id, id));
  if (!paper) return null;
  const [domainRows, signalRows, [evidence], relatedRows, [lastAction]] = await Promise.all([
    db
      .select({
        name: domains.name,
        cosine: paperDomain.cosine,
        relevance: paperDomain.llmRelevance,
        novelty: paperDomain.novelty,
        signalType: paperDomain.signalType,
        clientAngle: paperDomain.clientAngle,
        riskFlags: paperDomain.riskFlags,
        finalScore: paperDomain.finalScore,
        verdict: paperDomain.verdict,
      })
      .from(paperDomain)
      .innerJoin(domains, eq(domains.id, paperDomain.domainId))
      .where(eq(paperDomain.paperId, id))
      .orderBy(sql`${paperDomain.finalScore} desc nulls last`),
    db.select().from(signals).where(eq(signals.paperId, id)).orderBy(desc(signals.capturedAt)),
    db.execute<{ rung: Rung | null; rising: boolean | null }>(sql`
      select rung, rising from research_signal.evidence where paper_id = ${id}::uuid`),
    db.execute<{ id: string; title: string; cosine: number; rung: Rung | null }>(sql`
      with n as (
        select p2.id, p2.title, -(p2.embedding <#> p.embedding) as cosine
        from research_signal.papers p
        join research_signal.papers p2 on p2.id <> p.id and p2.embedding is not null
        where p.id = ${id}::uuid and p.embedding is not null
        order by p2.embedding <#> p.embedding
        limit ${RELATED_K}
      )
      select n.id, n.title, n.cosine, e.rung
      from n left join research_signal.evidence e on e.paper_id = n.id
      order by n.cosine desc`),
    db
      .select({ action: actions.action })
      .from(actions)
      .where(eq(actions.paperId, id))
      .orderBy(desc(actions.createdAt))
      .limit(1),
  ]);
  const buildsOn = (signalRows.find((s) => s.buildsOn !== null)?.buildsOn ?? null) as BuildsOn | null;
  return { paper, domainRows, signalRows, evidence, relatedRows, buildsOn, lastAction: lastAction?.action ?? null };
}

const chip =
  "glass-chip glass-interactive inline-flex h-7 items-center px-3 text-[0.8rem] font-medium hover:text-foreground";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="micro flex items-center gap-3 after:h-px after:flex-1 after:bg-rule/50">{title}</h2>
      {children}
    </section>
  );
}

const dash = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "–" : v);

async function PaperView({ id }: { id: string }) {
  const data = await load(id);
  if (!data) notFound();
  const { paper, domainRows, signalRows, evidence, relatedRows, buildsOn, lastAction } = data;
  const figures = (paper.figures ?? []).filter((f) => servable(f.url));
  const leadUrl = paper.figureUrl && servable(paper.figureUrl) ? paper.figureUrl : (figures[0]?.url ?? null);
  const gallery = leadUrl
    ? [
        { url: leadUrl, caption: figures.find((f) => f.url === leadUrl)?.caption ?? null },
        ...figures.filter((f) => f.url !== leadUrl),
      ].slice(0, GALLERY_MAX)
    : [];
  const signalType = domainRows.find((d) => d.signalType !== null)?.signalType ?? null;

  // signalRows is newest first; the chart reads oldest → newest over the latest snapshots.
  const latest = signalRows[0] ?? null;
  const venue = signalRows.find((s) => s.venue ?? s.orVenue);
  const cones = signalRows
    .slice(0, CONE_MAX)
    .reverse()
    .map((s) => ({
      label: snapshot(s.capturedAt),
      value: s.hfUpvotes ?? 0,
      display: s.hfUpvotes === null ? "–" : String(s.hfUpvotes),
    }));

  const upvotes = cones.map((c) => c.value);
  const delta = upvotes.length > 1 ? upvotes[upvotes.length - 1] - upvotes[0] : null;
  const history: [string, string][] = [
    ["Snapshots", String(signalRows.length)],
    ["Peak", upvotes.length ? String(Math.max(...upvotes)) : "–"],
    ["Change", delta === null ? "–" : `${delta > 0 ? "+" : ""}${delta}`],
  ];

  const words = paper.title.trim().split(/\s+/);
  const lastWord = words.pop() ?? "";

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="micro">
            Paper{paper.arxivId ? ` · arXiv ${paper.arxivId}` : ""} · {paper.source} · Announced{" "}
            <span className="num">{date(paper.announcedAt ?? paper.submittedAt)}</span>
          </span>
          {evidence?.rung ? <Badge variant="secondary">{evidence.rung}</Badge> : null}
          {evidence?.rising ? (
            <Badge variant="outline" className="text-rising">
              Rising
            </Badge>
          ) : null}
        </div>
        <h1 className="font-display text-[28px] leading-tight font-semibold tracking-tight sm:text-[36px]">
          {words.length ? `${words.join(" ")} ` : null}
          <span className="text-signal-2">{lastWord}</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {paper.urlAbs ? (
            <a className={chip} href={paper.urlAbs} target="_blank" rel="noreferrer">
              Abstract page
            </a>
          ) : null}
          {paper.urlHtml ? (
            <a className={chip} href={paper.urlHtml} target="_blank" rel="noreferrer">
              HTML
            </a>
          ) : null}
          {paper.urlPdf ? (
            <a className={chip} href={paper.urlPdf} target="_blank" rel="noreferrer">
              PDF
            </a>
          ) : null}
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-rule/50 sm:inline-block" />
          <PaperActions paperId={paper.id} current={lastAction} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="plate p-4">
          <SpecTable
            caption="Specimen"
            rows={[
              [
                "Authors",
                paper.authors.length ? (
                  <span className="line-clamp-3" title={paper.authors.join(", ")}>
                    {paper.authors.join(", ")}
                  </span>
                ) : (
                  "–"
                ),
              ],
              ["Rung", evidence?.rung ? <EvidenceMeter rung={evidence.rung} /> : "–"],
              ["Signal", signalType ? <SignalChip signal={signalType} /> : "–"],
              ["HF upvotes", dash(latest?.hfUpvotes)],
              ["Stars", dash(latest?.githubStars)],
              ["Models / Spaces", `${dash(latest?.linkedModels)} / ${dash(latest?.linkedSpaces)}`],
              ["Citations", dash(latest?.s2Citations)],
              ["Venue", dash(venue?.venue ?? venue?.orVenue)],
              ["First seen", date(paper.createdAt)],
            ]}
          />
        </div>
        <div className="plate flex min-w-0 flex-col justify-between gap-6 p-4">
          {signalRows.length ? (
            <dl className="grid grid-cols-3 gap-4">
              {history.map(([label, value]) => (
                <div key={label} className="border-l-2 border-signal pl-3">
                  <dt className="micro">{label}</dt>
                  <dd className="mt-1 font-display text-2xl leading-none num">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <ConeChart title="HF upvotes by snapshot" unit="upvotes" data={cones} />
        </div>
      </div>

      <Section title={gallery.length ? `Figures · ${gallery.length}` : "Figures"}>
        <div className="plate flex flex-col gap-4 p-4">
          {gallery.length ? (
            <>
              <PaperFigure
                paperId={paper.id}
                arxivId={paper.arxivId}
                figureUrl={gallery[0].url}
                caption={gallery[0].caption}
                title={paper.title}
                priority
                authors={paper.authors}
                signalType={signalType}
                width={LEAD_W}
                height={LEAD_H}
                className="overflow-hidden rounded-tile"
              />
              {gallery.length > 1 ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {gallery.slice(1).map((f) => (
                    <PaperFigure
                      key={f.url}
                      paperId={paper.id}
                      arxivId={paper.arxivId}
                      figureUrl={f.url}
                      caption={f.caption}
                      title={paper.title}
                      authors={paper.authors}
                      signalType={signalType}
                      width={THUMB_W}
                      height={THUMB_H}
                      className="overflow-hidden rounded-tile"
                    />
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex items-center gap-4 text-signal">
              <PaperFigure
                paperId={paper.id}
                arxivId={paper.arxivId}
                figureUrl={null}
                authors={paper.authors}
                signalType={signalType}
                width={THUMB_W}
                height={THUMB_H}
                className="shrink-0 overflow-hidden rounded-tile"
              />
              <p className="text-sm text-muted-foreground">No figures extracted for this paper yet.</p>
            </div>
          )}
        </div>
      </Section>

      {paper.abstract ? (
        <Section title="Abstract">
          <div className="plate p-4 sm:p-5">
            <p className="max-w-prose text-[15px] leading-7">{paper.abstract}</p>
          </div>
        </Section>
      ) : null}

      {domainRows.length ? (
        <Section title="Per-domain verdicts">
          <ul className="flex flex-col gap-3">
            {domainRows.map((d) => (
              <li
                key={d.name}
                className="plate border-l-4 p-4 text-sm"
                style={d.verdict ? { borderLeftColor: COLORS_UI.verdict[d.verdict] } : undefined}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-heading font-medium">{d.name}</span>
                  {d.verdict ? (
                    <span className="micro font-semibold" style={{ color: COLORS_UI.verdict[d.verdict] }}>
                      {d.verdict}
                    </span>
                  ) : null}
                  {d.signalType ? <SignalChip signal={d.signalType} /> : null}
                  <span className="num text-xs text-muted-foreground">
                    final {score(d.finalScore)} · cosine {score(d.cosine)} · relevance {d.relevance ?? "–"}/5 · novelty{" "}
                    {d.novelty ?? "–"}/5
                  </span>
                </div>
                {d.clientAngle ? <p className="mt-2 leading-6">{d.clientAngle}</p> : null}
                {d.riskFlags.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">Risks: {d.riskFlags.join(", ")}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Signals history">
        {signalRows.length ? (
          <div className="plate overflow-x-auto">
            <table className="w-full text-left text-sm tabular-nums">
              <thead>
                <tr className="border-b border-border">
                  {["Captured", "HF upvotes", "Comments", "GitHub", "Stars", "Models", "Spaces", "Venue", "Review", "Citations"].map(
                    (h) => (
                      <th key={h} className="micro px-3 py-2 font-medium whitespace-nowrap first:pl-4">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {signalRows.map((s) => (
                  <tr key={s.id} className="border-t border-border first:border-t-0 hover:bg-plate-hover">
                    <td className="py-1.5 pr-3 pl-4 whitespace-nowrap">{date(s.capturedAt)}</td>
                    <td className="px-3 py-1.5">{s.hfUpvotes ?? "–"}</td>
                    <td className="px-3 py-1.5">{s.hfComments ?? "–"}</td>
                    <td className="px-3 py-1.5">
                      {s.githubRepo ? (
                        <a className="text-signal underline underline-offset-4" href={s.githubRepo} target="_blank" rel="noreferrer">
                          repo
                        </a>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className="px-3 py-1.5">{s.githubStars ?? "–"}</td>
                    <td className="px-3 py-1.5">{s.linkedModels ?? "–"}</td>
                    <td className="px-3 py-1.5">{s.linkedSpaces ?? "–"}</td>
                    <td className="px-3 py-1.5">{s.venue ?? s.orVenue ?? "–"}</td>
                    <td className="px-3 py-1.5">{s.orDecision ?? "–"}</td>
                    <td className="px-3 py-1.5">{s.s2Citations ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="plate p-4 text-sm text-muted-foreground">No signals captured yet.</p>
        )}
      </Section>

      {buildsOn?.length ? (
        <Section title="Builds on">
          <ul className="plate flex flex-col divide-y divide-border text-sm">
            {buildsOn.map((b, i) => (
              <li key={b.paperId ?? i} className="px-4 py-2">
                {b.title}
                {b.citationCount !== null ? (
                  <span className="num text-muted-foreground"> · {b.citationCount} citations</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Related papers">
        {relatedRows.length ? (
          <ul className="plate flex flex-col divide-y divide-border text-sm">
            {relatedRows.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3 px-4 py-2 hover:bg-plate-hover">
                <Link className="underline-offset-4 hover:text-signal hover:underline" href={`/paper/${r.id}`}>
                  {r.title}
                </Link>
                <span className="micro shrink-0 num">
                  {r.rung ?? "LAB"} · {Number(r.cosine).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="plate p-4 text-sm text-muted-foreground">No embedding yet, so no neighbours.</p>
        )}
      </Section>
    </article>
  );
}

export default async function PaperPage({ params }: PageProps<"/paper/[id]">) {
  await connection();
  const { id: raw } = await params;
  if (!UUID.test(raw)) notFound();
  const id = raw.toLowerCase();
  const [exists] = await db.select({ id: papers.id }).from(papers).where(eq(papers.id, id));
  if (!exists) notFound();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p className="micro">Loading…</p>}>
        <PaperView id={id} />
      </Suspense>
    </main>
  );
}
