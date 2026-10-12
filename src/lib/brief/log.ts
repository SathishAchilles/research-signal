import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { actions } from "@/db/schema";
import { setPaperSearchFacets, upsertSearchDoc } from "@/lib/search/index";
import type { ActionKind } from "./types";

export const ACTION_KINDS = ["READ", "CLIENT", "SKIP"] as const;
export type ActionOrigin = "email" | "web" | "ask";

export const isActionKind = (value: unknown): value is ActionKind =>
  typeof value === "string" && (ACTION_KINDS as readonly string[]).includes(value);

export const ACTION_LABEL: Record<ActionKind, string> = { READ: "Read", CLIENT: "Share with clients", SKIP: "Skip" };

type Latest = { id: number; action: ActionKind; note: string | null; client_tag: string | null };

async function latestAction(paperId: string): Promise<Latest | undefined> {
  const [row] = await db.execute<Latest>(sql`
    select id, action, note, client_tag from research_signal.actions
    where paper_id = ${paperId} order by created_at desc, id desc limit 1`);
  return row;
}

async function indexNote(paperId: string, note: string | null, clientTag: string | null, action: ActionKind) {
  if (!note?.trim() && !clientTag?.trim()) return;
  const [paper] = await db.execute<{ title: string; published_at: string | null; domain_ids: number[] | null }>(sql`
    select p.title, coalesce(p.announced_at, p.submitted_at) as published_at,
      (select array_agg(pd.domain_id order by pd.domain_id) from research_signal.paper_domain pd where pd.paper_id = p.id) as domain_ids
    from research_signal.papers p where p.id = ${paperId}`);
  if (!paper) return;
  await upsertSearchDoc({
    entityType: "note",
    entityId: paperId,
    paperId,
    title: paper.title,
    body: [note?.trim(), clientTag?.trim() ? `Client: ${clientTag.trim()}` : ""].filter(Boolean).join("\n"),
    facets: {
      domainIds: (paper.domain_ids ?? []).map(Number),
      userAction: action,
      publishedAt: paper.published_at ? new Date(paper.published_at) : null,
    },
  });
}

// Sets the paper's current action. Repeating the current action is a no-op, so replays and double
// clicks add no rows; a changed action keeps the earlier note and client tag unless new ones are given.
export async function recordAction(input: {
  paperId: string;
  action: ActionKind;
  origin: ActionOrigin;
  note?: string | null;
  clientTag?: string | null;
}): Promise<{ id: number; changed: boolean }> {
  const latest = await latestAction(input.paperId);
  const note = input.note ?? latest?.note ?? null;
  const clientTag = input.clientTag ?? latest?.client_tag ?? null;
  if (latest && latest.action === input.action && note === latest.note && clientTag === latest.client_tag) {
    return { id: Number(latest.id), changed: false };
  }
  const [row] = await db
    .insert(actions)
    .values({ paperId: input.paperId, action: input.action, origin: input.origin, note, clientTag })
    .returning({ id: actions.id });
  await setPaperSearchFacets([input.paperId], { userAction: input.action });
  if (input.note !== undefined || input.clientTag !== undefined) await indexNote(input.paperId, note, clientTag, input.action);
  return { id: row.id, changed: true };
}

// Edits the note and client tag on the paper's current action, allowed for READ and CLIENT only.
export async function updateActionNote(paperId: string, note: string, clientTag: string): Promise<{ ok: boolean; error?: string }> {
  const latest = await latestAction(paperId);
  if (!latest) return { ok: false, error: "This paper has no action yet." };
  if (latest.action === "SKIP") return { ok: false, error: "Notes and client tags are for Read or Share with clients papers." };
  const cleanNote = note.trim().slice(0, 4000) || null;
  const cleanTag = clientTag.trim().slice(0, 80) || null;
  await db.execute(sql`
    update research_signal.actions set note = ${cleanNote}, client_tag = ${cleanTag} where id = ${latest.id}`);
  await indexNote(paperId, cleanNote, cleanTag, latest.action);
  return { ok: true };
}

export type LogFilters = { action?: ActionKind; domainId?: number; client?: string; from?: string; to?: string };

export type LogRow = {
  paperId: string;
  title: string;
  link: string | null;
  domains: string;
  rung: string | null;
  verdict: string | null;
  action: ActionKind;
  note: string | null;
  clientTag: string | null;
  origin: string;
  date: string;
  figureUrl: string | null;
  signalType: string | null;
};

export const LOG_LIMIT = 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseLogFilters(params: Record<string, string | string[] | undefined> | URLSearchParams): LogFilters {
  const get = (key: string) => {
    const value = params instanceof URLSearchParams ? params.get(key) : params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };
  const action = get("action");
  const domain = Number(get("domain"));
  const from = get("from");
  const to = get("to");
  return {
    action: isActionKind(action) ? action : undefined,
    domainId: Number.isInteger(domain) && domain > 0 ? domain : undefined,
    client: get("client"),
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
  };
}

// Papers with a current action, newest first. The CSV export uses the same query, so the two match.
export async function listLog(filters: LogFilters): Promise<LogRow[]> {
  const rows = await db.execute<{
    paper_id: string;
    title: string;
    link: string | null;
    domains: string | null;
    rung: string | null;
    verdict: string | null;
    action: ActionKind;
    note: string | null;
    client_tag: string | null;
    origin: string;
    created_at: string;
    figure_url: string | null;
    signal_type: string | null;
  }>(sql`
    with latest as (
      select distinct on (a.paper_id) a.*
      from research_signal.actions a
      order by a.paper_id, a.created_at desc, a.id desc
    )
    select l.paper_id, p.title, coalesce(p.url_abs, p.url_pdf) as link,
      (select string_agg(d.name, '; ' order by d.name) from research_signal.paper_domain pd
        join research_signal.domains d on d.id = pd.domain_id where pd.paper_id = p.id) as domains,
      e.rung::text as rung,
      (select pd.verdict::text from research_signal.paper_domain pd where pd.paper_id = p.id
        order by pd.final_score desc nulls last limit 1) as verdict,
      p.figure_url,
      (select pd.signal_type::text from research_signal.paper_domain pd where pd.paper_id = p.id
        order by pd.final_score desc nulls last limit 1) as signal_type,
      l.action, l.note, l.client_tag, l.origin::text as origin, l.created_at
    from latest l
    join research_signal.papers p on p.id = l.paper_id
    left join research_signal.evidence e on e.paper_id = p.id
    where true
      ${filters.action ? sql`and l.action = ${filters.action}::research_signal.action_kind` : sql``}
      ${filters.domainId ? sql`and exists (select 1 from research_signal.paper_domain pd where pd.paper_id = p.id and pd.domain_id = ${filters.domainId})` : sql``}
      ${filters.client ? sql`and l.client_tag ilike ${filters.client.replace(/[\\%_]/g, "\\$&")}` : sql``}
      ${filters.from ? sql`and l.created_at >= ${filters.from}::date` : sql``}
      ${filters.to ? sql`and l.created_at < ${filters.to}::date + 1` : sql``}
    order by l.created_at desc
    limit ${LOG_LIMIT}`);
  return rows.map((r) => ({
    paperId: r.paper_id,
    title: r.title,
    link: r.link,
    domains: r.domains ?? "",
    rung: r.rung,
    verdict: r.verdict,
    action: r.action,
    note: r.note,
    clientTag: r.client_tag,
    origin: r.origin,
    date: new Date(r.created_at).toISOString().slice(0, 10),
    figureUrl: r.figure_url,
    signalType: r.signal_type,
  }));
}

export const CSV_COLUMNS = ["title", "link", "domain", "rung", "verdict", "action", "note", "client tag", "date"] as const;

const csvCell = (value: string | null) => {
  const text = value ?? "";
  // A leading = + - @ would run as a formula in spreadsheet apps.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(rows: LogRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [r.title, r.link, r.domains, r.rung, r.verdict, ACTION_LABEL[r.action], r.note, r.clientTag, r.date].map(csvCell).join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
