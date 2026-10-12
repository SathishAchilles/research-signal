import Link from "next/link";
import { Suspense } from "react";
import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { domains } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { ACTION_KINDS, ACTION_LABEL, type LogFilters, listLog, parseLogFilters } from "@/lib/brief/log";
import { NoteEditor } from "./note-editor";

export default function LogPage({ searchParams }: PageProps<"/log">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Notable log</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every paper you marked, with notes and client tags. The latest action per paper wins.</p>
      </div>
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

const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

async function LogView({ searchParams }: Pick<PageProps<"/log">, "searchParams">) {
  const filters = parseLogFilters(await searchParams);
  const [rows, domainList] = await Promise.all([
    listLog(filters),
    db.select({ id: domains.id, name: domains.name }).from(domains).orderBy(asc(domains.name)),
  ]);
  const qs = queryString(filters);

  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          Action
          <select name="action" defaultValue={filters.action ?? ""} className={selectClass}>
            <option value="">Any</option>
            {ACTION_KINDS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Domain
          <select name="domain" defaultValue={filters.domainId ?? ""} className={selectClass}>
            <option value="">Any</option>
            {domainList.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Client tag
          <input name="client" defaultValue={filters.client ?? ""} className={`${selectClass} w-36`} placeholder="Acme" />
        </label>
        <label className="flex flex-col gap-1">
          From
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={selectClass} />
        </label>
        <label className="flex flex-col gap-1">
          To
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={selectClass} />
        </label>
        <button type="submit" className="h-9 rounded-md border px-3 font-medium">
          Filter
        </button>
        <Link href="/log" className="h-9 px-1 leading-9 underline">
          Clear
        </Link>
        <a href={`/api/log/export${qs ? `?${qs}` : ""}`} className="ml-auto h-9 rounded-md bg-primary px-3 leading-9 font-medium text-primary-foreground" download>
          Export CSV ({rows.length})
        </a>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No papers match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="log-table">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Paper</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Evidence</th>
                <th className="py-2 pr-3">Note and client</th>
                <th className="py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.paperId} className="border-t align-top" data-log-row>
                  <td className="py-3 pr-3">
                    <Link href={`/paper/${r.paperId}`} className="font-medium hover:underline">
                      {r.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.domains || "No domain"}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <Badge variant={r.action === "CLIENT" ? "default" : "secondary"}>{ACTION_LABEL[r.action]}</Badge>
                    <div className="mt-1 text-xs text-muted-foreground">via {r.origin}</div>
                  </td>
                  <td className="py-3 pr-3 text-xs">
                    {r.rung ?? "LAB"} · {r.verdict ?? "unscored"}
                  </td>
                  <td className="py-3 pr-3">
                    <NoteEditor paperId={r.paperId} note={r.note ?? ""} clientTag={r.clientTag ?? ""} editable={r.action !== "SKIP"} />
                  </td>
                  <td className="py-3 text-xs whitespace-nowrap">{r.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
