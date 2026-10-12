import Link from "next/link";
import { Suspense } from "react";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { domains } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EvidenceMeter } from "@/components/brief/EvidenceMeter";
import { VerdictPill } from "@/components/brief/VerdictPill";
import { PaperFigure } from "@/components/paper/PaperFigure";
import { ACTION_KINDS, ACTION_LABEL, type LogFilters, listLog, parseLogFilters } from "@/lib/brief/log";
import type { Rung, SignalType, Verdict } from "@/lib/pipeline/rank";
import { cn } from "@/lib/utils";
import { NoteEditor } from "./note-editor";

export default function LogPage({ searchParams }: PageProps<"/log">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <p className="micro">Research-signal · Notable log</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Notable <span className="text-signal-2">log</span>
        </h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Every paper you marked, with notes and client tags. The latest action per paper wins.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the log…</p>}>
        <LogView searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function queryString(filters: LogFilters): string {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.domainId) params.set("domain", String(filters.domainId));
  if (filters.client) params.set("client", filters.client);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params.toString();
}

const RUNGS: readonly Rung[] = ["LAB", "CODE", "MODEL", "PEER"];
const VERDICTS: readonly Verdict[] = ["CLIENT", "READ", "SKIP"];
const SIGNAL_TYPES: readonly SignalType[] = ["BENCH", "EVAL", "REFRAME", "METHOD"];
const isRung = (value: string | null): value is Rung => value !== null && (RUNGS as readonly string[]).includes(value);
const isVerdict = (value: string | null): value is Verdict => value !== null && (VERDICTS as readonly string[]).includes(value);
const isSignalType = (value: string | null): value is SignalType =>
  value !== null && (SIGNAL_TYPES as readonly string[]).includes(value);

// Filter pills: glass-chip capsules (no backdrop-filter) holding a micro label and a bare control.
// Below sm each pill spans the row so its control gets the full width; on touch it is a 44px target.
const PILL_CLASS =
  "glass-chip flex h-9 items-center max-sm:w-full touch:h-12 gap-2 pl-3 pr-1.5 text-sm focus-within:border-(--glass-rim-top) has-focus-visible:outline-3 has-focus-visible:outline-solid has-focus-visible:outline-focus has-focus-visible:outline-offset-2";
const CONTROL_CLASS = "h-8 min-h-0 min-w-0 rounded-full max-sm:flex-1 touch:h-11 bg-transparent px-1.5 text-sm text-foreground outline-none [color-scheme:dark] placeholder:text-muted-foreground";

async function LogView({ searchParams }: Pick<PageProps<"/log">, "searchParams">) {
  const filters = parseLogFilters(await searchParams);
  const [rows, domainList] = await Promise.all([
    listLog(filters),
    db.select({ id: domains.id, name: domains.name }).from(domains).orderBy(asc(domains.name)),
  ]);
  const qs = queryString(filters);

  return (
    <>
      <form method="get" className="flex flex-wrap items-center gap-2 text-sm" aria-label="Filter the log">
        <label className={PILL_CLASS}>
          <span className="micro">Action</span>
          <select name="action" defaultValue={filters.action ?? ""} className={CONTROL_CLASS}>
            <option value="">Any</option>
            {ACTION_KINDS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label className={PILL_CLASS}>
          <span className="micro">Domain</span>
          <select name="domain" defaultValue={filters.domainId ?? ""} className={`${CONTROL_CLASS} sm:max-w-52`}>
            <option value="">Any</option>
            {domainList.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className={PILL_CLASS}>
          <span className="micro">Client</span>
          <input name="client" defaultValue={filters.client ?? ""} className={`${CONTROL_CLASS} sm:w-28`} placeholder="Acme" />
        </label>
        <label className={PILL_CLASS}>
          <span className="micro">From</span>
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={`${CONTROL_CLASS} num`} />
        </label>
        <label className={PILL_CLASS}>
          <span className="micro">To</span>
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={`${CONTROL_CLASS} num`} />
        </label>
        <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-full px-4 touch:h-11")}>
          Filter
        </button>
        <Link href="/log" className="h-9 rounded-full px-2 text-sm leading-9 touch:h-11 touch:px-3 touch:leading-[2.75rem] text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Clear
        </Link>
        <a
          href={`/api/log/export${qs ? `?${qs}` : ""}`}
          className={cn(buttonVariants({ size: "lg" }), "ml-auto rounded-full px-4 touch:h-11")}
          download
        >
          <span>
            Export CSV (<span className="num">{rows.length}</span>)
          </span>
          <span aria-hidden>↓</span>
        </a>
      </form>

      {rows.length === 0 ? (
        <p className="plate px-4 py-6 text-sm text-muted-foreground">No papers match these filters.</p>
      ) : (
        // Below lg the table restacks as one card per paper (CSS grid on each row). The explicit ARIA
        // roles keep the table semantics that display:block/grid would otherwise drop.
        <div className="plate lg:overflow-x-auto">
          <table role="table" className="w-full text-sm tabular-nums max-lg:block" data-testid="log-table">
            <thead role="rowgroup" className="border-b border-rule/50 text-left max-lg:sr-only">
              <tr role="row">
                <th role="columnheader" className="w-14 py-3 pr-2 pl-4">
                  <span className="sr-only">Figure</span>
                </th>
                <th role="columnheader" className="micro py-3 pr-3">Paper / domains</th>
                <th role="columnheader" className="micro py-3 pr-3">Action</th>
                <th role="columnheader" className="micro py-3 pr-3">Evidence</th>
                <th role="columnheader" className="micro py-3 pr-3">Note and client</th>
                <th role="columnheader" className="micro py-3 pr-4">Date</th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="divide-y divide-border max-lg:block">
              {rows.map((r) => {
                const rung: Rung = isRung(r.rung) ? r.rung : "LAB";
                return (
                  <tr
                    key={r.paperId}
                    role="row"
                    className="align-top transition-colors hover:bg-plate-hover max-lg:grid max-lg:grid-cols-[2.5rem_minmax(0,1fr)_auto] max-lg:gap-x-3 max-lg:gap-y-2.5 max-lg:p-4"
                    data-log-row
                  >
                    <td role="cell" className="py-3 pr-2 pl-4 max-lg:p-0">
                      <PaperFigure
                        paperId={r.paperId}
                        arxivId={null}
                        figureUrl={r.figureUrl}
                        authors={[]}
                        signalType={isSignalType(r.signalType) ? r.signalType : null}
                        title={r.title}
                        width={40}
                        height={40}
                        showCaption={false}
                        linked={false}
                      />
                    </td>
                    <td role="cell" className="py-3 pr-3 max-lg:col-span-2 max-lg:p-0">
                      <Link href={`/paper/${r.paperId}`} className="font-medium text-foreground underline-offset-4 hover:text-signal-2 hover:underline">
                        {r.title}
                      </Link>
                      <div className="mt-0.5 text-xs text-muted-foreground">{r.domains || "No domain"}</div>
                    </td>
                    <td role="cell" className="py-3 pr-3 max-lg:col-span-2 max-lg:col-start-1 max-lg:row-start-2 max-lg:flex max-lg:items-center max-lg:gap-3 max-lg:p-0">
                      <Badge variant={r.action === "CLIENT" ? "default" : "secondary"}>{ACTION_LABEL[r.action]}</Badge>
                      <div className="micro mt-1.5 normal-case tracking-normal max-lg:mt-0">via {r.origin}</div>
                    </td>
                    <td role="cell" className="py-3 pr-3 text-xs whitespace-nowrap max-lg:col-span-3 max-lg:row-start-3 max-lg:p-0">
                      <div className="flex flex-col gap-1.5 max-lg:flex-row max-lg:flex-wrap max-lg:items-center max-lg:gap-3">
                        <EvidenceMeter rung={rung} />
                        <VerdictPill verdict={isVerdict(r.verdict) ? r.verdict : null} />
                      </div>
                    </td>
                    <td role="cell" className="py-3 pr-3 max-lg:col-span-3 max-lg:row-start-4 max-lg:p-0">
                      <NoteEditor paperId={r.paperId} note={r.note ?? ""} clientTag={r.clientTag ?? ""} editable={r.action !== "SKIP"} />
                    </td>
                    <td role="cell" className="num py-3 pr-4 font-mono text-xs whitespace-nowrap text-muted-foreground max-lg:col-start-3 max-lg:row-start-2 max-lg:self-center max-lg:p-0 max-lg:text-right">
                      <time dateTime={r.date}>{r.date}</time>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
