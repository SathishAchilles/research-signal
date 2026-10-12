import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { AskPanel, type CitedFigure } from "@/components/ask/AskPanel";
import { db } from "@/db/client";
import { askMessages, askThreads, papers } from "@/db/schema";
import type { SignalType } from "@/lib/pipeline/rank";
import { cn } from "@/lib/utils";

// The rail shows only the most recent threads; older ones stay reachable by their /ask?thread= link.
const THREAD_LIMIT = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Paper ids cited by the saved answers. citations is untyped jsonb, so only well-formed ids are kept.
function citedPaperIds(messages: { citations: unknown }[]): string[] {
  const ids = new Set<string>();
  for (const m of messages) {
    if (!Array.isArray(m.citations)) continue;
    for (const c of m.citations) {
      const id = (c as { paperId?: unknown } | null)?.paperId;
      if (typeof id === "string" && UUID.test(id)) ids.add(id);
    }
  }
  return [...ids];
}

async function AskView({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const parsed = z.uuid().safeParse(first(params.thread));
  const threadId = parsed.success ? parsed.data : undefined;
  // /ask?q=… (from the command bar) asks the question in a new thread.
  const q = first(params.q)?.trim().slice(0, 2000) || undefined;

  const [threads, active, saved] = await Promise.all([
    db
      .select({ id: askThreads.id, title: askThreads.title, createdAt: askThreads.createdAt })
      .from(askThreads)
      .orderBy(desc(askThreads.createdAt))
      .limit(THREAD_LIMIT),
    threadId
      ? db.select({ id: askThreads.id, title: askThreads.title }).from(askThreads).where(eq(askThreads.id, threadId))
      : Promise.resolve([]),
    threadId
      ? db
          .select({
            id: askMessages.id,
            role: askMessages.role,
            content: askMessages.content,
            intent: askMessages.intent,
            citations: askMessages.citations,
            confidence: askMessages.confidence,
            coverage: askMessages.coverage,
          })
          .from(askMessages)
          .where(eq(askMessages.threadId, threadId))
          .orderBy(asc(askMessages.createdAt))
      : Promise.resolve([]),
  ]);
  const thread = active[0];

  // Lead figures for the cited papers' thumbnails, with the attribution fields and the best-scored
  // domain's signal type (for the glyph fallback) in the same query. A live answer gets its figures
  // on the router.refresh() that follows its save.
  const paperIds = thread ? citedPaperIds(saved) : [];
  const figureRows = paperIds.length
    ? await db
        .select({
          id: papers.id,
          arxivId: papers.arxivId,
          authors: papers.authors,
          figureUrl: papers.figureUrl,
          figures: papers.figures,
          signalType: sql<SignalType | null>`(select pd.signal_type::text from research_signal.paper_domain pd
            where pd.paper_id = ${papers.id} and pd.signal_type is not null
            order by pd.final_score desc nulls last limit 1)`,
        })
        .from(papers)
        .where(inArray(papers.id, paperIds))
    : [];
  const figures: Record<string, CitedFigure> = Object.fromEntries(
    figureRows.map((r) => {
      const figureUrl = r.figureUrl ?? r.figures?.[0]?.url ?? null;
      const caption = r.figures?.find((f) => f.url === figureUrl)?.caption ?? null;
      // Two authors are enough for "Figure: <first author> et al.".
      return [r.id, { figureUrl, caption, signalType: r.signalType, arxivId: r.arxivId, authors: r.authors.slice(0, 2) }];
    }),
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start lg:gap-6">
      {/* Below lg the threads are a horizontal chip row above the conversation; at lg they are a
          sticky sidebar. Rows are shrink-0 so the flex column never squeezes them (an overflow-hidden
          flex item has a zero min-height and was being clipped through its text). */}
      <nav
        aria-label="Threads"
        className="glass-base flex flex-row items-center gap-2 overflow-x-auto overscroll-x-contain p-2 [scrollbar-width:none] text-sm lg:sticky lg:top-[76px] lg:flex-col lg:items-stretch lg:gap-1 lg:overflow-visible lg:p-3"
      >
        <p className="micro hidden px-2 pb-1 lg:block">Recent threads</p>
        <Link
          href="/ask"
          aria-current={thread ? undefined : "page"}
          className="glass-chip glass-interactive shrink-0 px-3 py-2 leading-5 font-medium whitespace-nowrap lg:mb-2"
        >
          + New question
        </Link>
        {threads.map((t) => {
          const isActive = t.id === thread?.id;
          return (
            <Link
              key={t.id}
              href={`/ask?thread=${t.id}`}
              aria-current={isActive ? "page" : undefined}
              data-active={isActive || undefined}
              className={cn(
                "block max-w-[14rem] min-w-0 shrink-0 truncate rounded-tile border border-transparent px-3 py-2 leading-5 text-muted-foreground hover:bg-plate-hover hover:text-foreground lg:max-w-none",
                isActive && "border-border bg-plate-hover font-medium text-foreground",
              )}
              title={t.title}
            >
              {t.title}
            </Link>
          );
        })}
      </nav>
      <AskPanel
        key={thread?.id ?? "new"}
        threadId={thread?.id}
        title={thread?.title}
        saved={thread ? saved : []}
        initialPrompt={thread ? undefined : q}
        figures={figures}
      />
    </div>
  );
}

export default function AskPage({ searchParams }: PageProps<"/ask">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <p className="micro">Research-signal · Ask the archive</p>
        <h1 className="font-display text-4xl leading-none font-semibold tracking-tight">Ask</h1>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <AskView searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
