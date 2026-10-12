import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db/client";
import { papers } from "@/db/schema";
import { verifyAction } from "@/lib/brief/actions-link";
import { ACTION_LABEL } from "@/lib/brief/log";
import { RecordAction } from "./record";

export default function ActionLinkPage({ params, searchParams }: PageProps<"/a/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-4 px-4 py-16">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Checking the link…</p>}>
        <ActionLink params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ActionLink({ params, searchParams }: Pick<PageProps<"/a/[token]">, "params" | "searchParams">) {
  const { token: raw } = await params;
  // Expiry is checked against the request time, not a prerender time.
  await connection();
  const token = decodeURIComponent(raw);
  const claim = verifyAction(token);
  if (!claim) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">This link is not valid</h1>
        <p className="text-sm text-muted-foreground">It may have expired (links last 30 days) or been changed. Nothing was recorded.</p>
      </div>
    );
  }
  const [paper] = await db.select({ title: papers.title, urlAbs: papers.urlAbs }).from(papers).where(eq(papers.id, claim.p));
  const recorded = (await searchParams).recorded === "1";
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">research-signal</p>
      <h1 className="text-xl font-semibold tracking-tight">{paper?.title ?? "Unknown paper"}</h1>
      <p>
        Action: <strong>{ACTION_LABEL[claim.a]}</strong>
      </p>
      <RecordAction token={token} alreadyRecorded={recorded} disabled={!paper} />
      <noscript>
        {recorded ? null : (
          <form method="post" action="/api/actions">
            <input type="hidden" name="token" value={token} />
            <button type="submit" className="rounded-md border px-3 py-2 text-sm font-medium">
              Record “{ACTION_LABEL[claim.a]}”
            </button>
          </form>
        )}
      </noscript>
      {paper?.urlAbs ? (
        <a className="text-sm underline" href={paper.urlAbs}>
          Open the abstract
        </a>
      ) : null}
    </div>
  );
}
