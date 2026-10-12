import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { AskPanel } from "@/components/ask/AskPanel";
import { db } from "@/db/client";
import { askMessages, askThreads } from "@/db/schema";
import { cn } from "@/lib/utils";

const THREAD_LIMIT = 50;

async function AskView({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const raw = (await searchParams).thread;
  const parsed = z.uuid().safeParse(Array.isArray(raw) ? raw[0] : raw);
  const threadId = parsed.success ? parsed.data : undefined;

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

  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <nav aria-label="Threads" className="flex flex-col gap-1 text-sm">
        <Link
          href="/ask"
          className={cn("rounded-md px-2 py-1 font-medium hover:bg-muted", !thread && "bg-muted")}
        >
          New question
        </Link>
        {threads.map((t) => (
          <Link
            key={t.id}
            href={`/ask?thread=${t.id}`}
            className={cn("truncate rounded-md px-2 py-1 hover:bg-muted", t.id === thread?.id && "bg-muted")}
            title={t.title}
          >
            {t.title}
          </Link>
        ))}
      </nav>
      <AskPanel key={thread?.id ?? "new"} threadId={thread?.id} title={thread?.title} saved={thread ? saved : []} />
    </div>
  );
}

export default function AskPage({ searchParams }: PageProps<"/ask">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Ask</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <AskView searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
