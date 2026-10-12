import Link from "next/link";
import { Suspense } from "react";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { domains } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EvidenceMeter } from "@/components/brief/EvidenceMeter";
import { VerdictLabel } from "@/components/brief/VerdictBar";
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
const PILL_CLASS =
  "glass-chip flex h-9 items-center gap-2 pl-3 pr-1.5 text-sm focus-within:border-(--glass-rim-top) has-focus-visible:outline-3 has-focus-visible:outline-solid has-focus-visible:outline-focus has-focus-visible:outline-offset-2";
const CONTROL_CLASS = "h-8 min-w-0 rounded-full bg-transparent px-1.5 text-sm text-foreground outline-none [color-scheme:dark] placeholder:text-muted-foreground";

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
          <select name="domain" defaultValue={filters.domainId ?? ""} className={`${CONTROL_CLASS} max-w-52`}>
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
          <input name="client" defaultValue={filters.client ?? ""} className={`${CONTROL_CLASS} w-28`} placeholder="Acme" />
        </label>
        <label className={PILL_CLASS}>
          <span className="micro">From</span>
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={`${CONTROL_CLASS} num`} />
        </label>
        <label className={PILL_CLASS}>
          <span className="micro">To</span>
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={`${CONTROL_CLASS} num`} />
        </label>
        <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-full px-4")}>
          Filter
        </button>
        <Link href="/log" className="h-9 rounded-full px-2 text-sm leading-9 text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Clear
        </Link>
        <a
          href={`/api/log/export${qs ? `?${qs}` : ""}`}
          className={cn(buttonVariants({ size: "lg" }), "ml-auto rounded-full px-4")}
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
        <div className="plate overflow-x-auto">
          <table className="w-full text-sm tabular-nums" data-testid="log-table">
            <thead className="border-b border-rule/50 text-left">
              <tr>
                <th className="w-14 py-3 pr-2 pl-4">
                  <span className="sr-only">Figure</span>
                </th>
                <th className="micro py-3 pr-3">Paper / domains</th>
                <th className="micro py-3 pr-3">Action</th>
                <th className="micro py-3 pr-3">Evidence</th>
                <th className="micro py-3 pr-3">Note and client</th>
                <th className="micro py-3 pr-4">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const rung: Rung = isRung(r.rung) ? r.rung : "LAB";
                return (
                  <tr key={r.paperId} className="align-top transition-colors hover:bg-plate-hover" data-log-row>
                    <td className="py-3 pr-2 pl-4">
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
                    <td className="py-3 pr-3">
                      <Link href={`/paper/${r.paperId}`} className="font-medium text-foreground underline-offset-4 hover:text-signal-2 hover:underline">
                        {r.title}
                      </Link>
                      <div className="mt-0.5 text-xs text-muted-foreground">{r.domains || "No domain"}</div>
                    </td>
                    <td className="py-3 pr-3">
                      <Badge variant={r.action === "CLIENT" ? "default" : "secondary"}>{ACTION_LABEL[r.action]}</Badge>
                      <div className="micro mt-1.5 normal-case tracking-normal">via {r.origin}</div>
                    </td>
                    <td className="py-3 pr-3 text-xs whitespace-nowrap">
                      <div className="flex flex-col gap-1.5">
                        <EvidenceMeter rung={rung} />
                        {isVerdict(r.verdict) ? (
                          <VerdictLabel verdict={r.verdict} />
                        ) : (
                          <span className="font-mono text-[11px] tracking-[.08em] text-muted-foreground">{r.verdict ?? "UNSCORED"}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <NoteEditor paperId={r.paperId} note={r.note ?? ""} clientTag={r.clientTag ?? ""} editable={r.action !== "SKIP"} />
                    </td>
                    <td className="num py-3 pr-4 font-mono text-xs whitespace-nowrap text-muted-foreground">
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
