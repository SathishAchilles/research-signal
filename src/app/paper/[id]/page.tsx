import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PaperFigure } from "@/components/paper/PaperFigure";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db/client";
import { actions, domains, paperDomain, papers, signals } from "@/db/schema";
import type { Rung } from "@/lib/pipeline/rank";
import { PaperActions } from "./PaperActions";

// The existence check runs before anything streams, so an unknown id is a real 404.
export const instant = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELATED_K = 8;
const GALLERY_WIDTH = 240;

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

async function PaperView({ id }: { id: string }) {
  const data = await load(id);
  if (!data) notFound();
  const { paper, domainRows, signalRows, evidence, relatedRows, buildsOn, lastAction } = data;
  const figures = (paper.figures ?? []).filter((f) => servable(f.url));
  const lead = paper.figureUrl && servable(paper.figureUrl) ? paper.figureUrl : null;
  const leadCaption = lead ? (figures.find((f) => f.url === lead)?.caption ?? null) : null;
  const gallery = figures.filter((f) => f.url !== lead);
  const signalType = domainRows.find((d) => d.signalType !== null)?.signalType ?? null;

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {evidence?.rung ? <Badge variant="secondary">{evidence.rung}</Badge> : null}
          {evidence?.rising ? <Badge variant="outline">Rising</Badge> : null}
          <span>{paper.source}</span>
          <span>·</span>
          <span>Announced {date(paper.announcedAt ?? paper.submittedAt)}</span>
          {paper.arxivId ? (
            <>
              <span>·</span>
              <span>arXiv {paper.arxivId}</span>
            </>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{paper.title}</h1>
        {paper.authors.length ? <p className="text-sm text-muted-foreground">{paper.authors.join(", ")}</p> : null}
        <div className="flex flex-wrap gap-3 text-sm">
          {paper.urlAbs ? <a className="underline underline-offset-4" href={paper.urlAbs} target="_blank" rel="noreferrer">Abstract page</a> : null}
          {paper.urlHtml ? <a className="underline underline-offset-4" href={paper.urlHtml} target="_blank" rel="noreferrer">HTML</a> : null}
          {paper.urlPdf ? <a className="underline underline-offset-4" href={paper.urlPdf} target="_blank" rel="noreferrer">PDF</a> : null}
        </div>
        <PaperActions paperId={paper.id} current={lastAction} />
      </header>

      <PaperFigure
        paperId={paper.id}
        arxivId={paper.arxivId}
        figureUrl={lead}
        caption={leadCaption}
        authors={paper.authors}
        signalType={signalType}
        width={640}
        height={360}
      />

      {gallery.length ? (
        <Section title="Figures">
          <div className="flex flex-wrap gap-4">
            {gallery.map((f) => (
              <PaperFigure
                key={f.url}
                paperId={paper.id}
                arxivId={paper.arxivId}
                figureUrl={f.url}
                caption={f.caption}
                authors={paper.authors}
                signalType={signalType}
                width={GALLERY_WIDTH}
                height={160}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {paper.abstract ? (
        <Section title="Abstract">
          <p className="text-sm leading-6">{paper.abstract}</p>
        </Section>
      ) : null}

      {domainRows.length ? (
        <Section title="Domains">
          <ul className="flex flex-col gap-3">
            {domainRows.map((d) => (
              <li key={d.name} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{d.name}</span>
                  {d.verdict ? <Badge>{d.verdict}</Badge> : null}
                  {d.signalType ? <Badge variant="outline">{d.signalType}</Badge> : null}
                  <span className="text-muted-foreground">
                    final {score(d.finalScore)} · cosine {score(d.cosine)} · relevance {d.relevance ?? "–"}/5 · novelty{" "}
                    {d.novelty ?? "–"}/5
                  </span>
                </div>
                {d.clientAngle ? <p className="mt-2">{d.clientAngle}</p> : null}
                {d.riskFlags.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">Risks: {d.riskFlags.join(", ")}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Signals">
        {signalRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  {["Captured", "HF upvotes", "Comments", "GitHub", "Stars", "Models", "Spaces", "Venue", "Review", "Citations"].map(
                    (h) => (
                      <th key={h} className="py-1 pr-4 font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {signalRows.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="py-1 pr-4 whitespace-nowrap">{date(s.capturedAt)}</td>
                    <td className="py-1 pr-4">{s.hfUpvotes ?? "–"}</td>
                    <td className="py-1 pr-4">{s.hfComments ?? "–"}</td>
                    <td className="py-1 pr-4">
                      {s.githubRepo ? (
                        <a className="underline underline-offset-4" href={s.githubRepo} target="_blank" rel="noreferrer">
                          repo
                        </a>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className="py-1 pr-4">{s.githubStars ?? "–"}</td>
                    <td className="py-1 pr-4">{s.linkedModels ?? "–"}</td>
                    <td className="py-1 pr-4">{s.linkedSpaces ?? "–"}</td>
                    <td className="py-1 pr-4">{s.venue ?? s.orVenue ?? "–"}</td>
                    <td className="py-1 pr-4">{s.orDecision ?? "–"}</td>
                    <td className="py-1 pr-4">{s.s2Citations ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No signals captured yet.</p>
        )}
      </Section>

      {buildsOn?.length ? (
        <Section title="Builds on">
          <ul className="list-disc pl-5 text-sm">
            {buildsOn.map((b, i) => (
              <li key={b.paperId ?? i}>
                {b.title}
                {b.citationCount !== null ? <span className="text-muted-foreground"> · {b.citationCount} citations</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Related papers">
        {relatedRows.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {relatedRows.map((r) => (
              <li key={r.id} className="flex items-baseline gap-2">
                <Link className="underline underline-offset-4" href={`/paper/${r.id}`}>
                  {r.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {r.rung ?? "LAB"} · {Number(r.cosine).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No embedding yet, so no neighbours.</p>
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
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <PaperView id={id} />
      </Suspense>
    </main>
  );
}
