import { redirect } from "next/navigation";
import { Suspense } from "react";
import { latestBriefWeek } from "@/lib/brief/load";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-2 px-4 py-16">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Opening the latest brief…</p>}>
        <LatestBrief />
      </Suspense>
    </main>
  );
}

async function LatestBrief() {
  const isoWeek = await latestBriefWeek();
  if (isoWeek) redirect(`/brief/${isoWeek}`);
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">No brief yet</h1>
      <p className="text-sm text-muted-foreground">The first weekly brief appears here after the Sunday run or a backfill.</p>
    </>
  );
}
