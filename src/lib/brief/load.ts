import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { briefs, papers } from "@/db/schema";
import type { ActionKind, BriefDoc } from "./types";

export type StoredBrief = { id: string; isoWeek: string; status: string; doc: BriefDoc; scheduledFor: Date | null };

export async function loadBrief(isoWeek: string): Promise<StoredBrief | null> {
  const [row] = await db
    .select({ id: briefs.id, isoWeek: briefs.isoWeek, status: briefs.status, json: briefs.json, scheduledFor: briefs.scheduledFor })
    .from(briefs)
    .where(and(eq(briefs.isoWeek, isoWeek), isNotNull(briefs.json)));
  return row ? { id: row.id, isoWeek: row.isoWeek, status: row.status, doc: row.json as BriefDoc, scheduledFor: row.scheduledFor } : null;
}

export async function latestBriefWeek(): Promise<string | null> {
  const [row] = await db
    .select({ isoWeek: briefs.isoWeek })
    .from(briefs)
    .where(and(isNotNull(briefs.json), ne(briefs.status, "FAILED")))
    .orderBy(desc(briefs.windowStart))
    .limit(1);
  return row?.isoWeek ?? null;
}

// The current action per paper, for showing which button is already pressed.
export async function currentActions(paperIds: string[]): Promise<Record<string, ActionKind>> {
  if (paperIds.length === 0) return {};
  const rows = await db.execute<{ paper_id: string; action: ActionKind }>(sql`
    select distinct on (paper_id) paper_id, action from research_signal.actions
    where paper_id in ${paperIds} order by paper_id, created_at desc, id desc`);
  return Object.fromEntries(rows.map((r) => [r.paper_id, r.action]));
}

// A paper's lead figure for the web brief (figure stage, domain banners, HERO card). Callers
// check the host with isServableFigure before handing the URL to next/image.
export type BriefFigure = { url: string; caption: string | null; source: string | null; authors: string[] };

export async function briefFigures(paperIds: string[]): Promise<Record<string, BriefFigure>> {
  if (paperIds.length === 0) return {};
  const rows = await db
    .select({ id: papers.id, figureUrl: papers.figureUrl, figureSource: papers.figureSource, figures: papers.figures, authors: papers.authors })
    .from(papers)
    .where(inArray(papers.id, paperIds));
  const out: Record<string, BriefFigure> = {};
  for (const r of rows) {
    if (!r.figureUrl) continue;
    const caption = r.figures?.find((f) => f.url === r.figureUrl)?.caption?.trim() || null;
    out[r.id] = { url: r.figureUrl, caption, source: r.figureSource, authors: r.authors };
  }
  return out;
}
