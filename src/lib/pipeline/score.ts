import { readFileSync } from "node:fs";
import path from "node:path";
import { generateObject } from "ai";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import pLimit from "p-limit";
import { z } from "zod";
import { db } from "@/db/client";
import { appSettings, domains, paperDomain, papers, signalType } from "@/db/schema";
import { LlmCreditsExhausted, llmCall } from "@/lib/llm/call";
import { chatModel } from "@/lib/llm/openrouter";
import { indexPaperSummaries } from "@/lib/search/index";
import { enqueue } from "./jobs";
import { rankAll } from "./rank";

const BATCH_SIZE = 25;
const CONCURRENCY = 4;
const SCORE_LIMIT = 300;
const TEMPERATURE = 0.2;
const CLIENT_ANGLE_WORDS = 18;
const ABSTRACT_MAX_CHARS = 2000;
// A batch's JSON is about 1.5k tokens; low reasoning plus this cap keeps each call bounded.
const REASONING_EFFORT = "low";
const MAX_OUTPUT_TOKENS = 3000;

export const ScoreBatch = z.object({
  papers: z.array(
    z.object({
      id: z.string(),
      domains: z.array(
        z.object({
          domainId: z.number().int(),
          relevance: z.number().int().min(0).max(5),
        }),
      ),
      signalType: z.enum(signalType.enumValues),
      novelty: z.number().int().min(0).max(5),
      clientAngle: z.string(),
      riskFlags: z.array(z.string()),
    }),
  ),
});
export type ScoreBatch = z.infer<typeof ScoreBatch>;

export type ScoreResult = {
  scored: number;
  batches: number;
  failedBatches: number;
  remaining: boolean;
  ranked: number;
  promoted: number;
};

type Candidate = { id: string; title: string; abstract: string; domainIds: number[] };

let rubric: string | undefined;
function loadRubric(): string {
  rubric ??= readFileSync(path.join(process.cwd(), "src/lib/pipeline/prompts/score.md"), "utf8");
  return rubric;
}

export function truncateWords(text: string, max = CLIENT_ANGLE_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, max).join(" ");
}

// Paper text is untrusted, so it can never close or open the tags that delimit it.
function untrusted(text: string): string {
  return text.replace(/<\/?\s*paper\b[^>]*>/gi, " ").replace(/\s+/g, " ").trim();
}

function systemPrompt(active: { id: number; name: string; description: string; keywords: string[] }[]): string {
  const list = active
    .map((d) => {
      const keywords = d.keywords.length ? ` Keywords: ${d.keywords.join(", ")}.` : "";
      return `- Domain ${d.id}: ${d.name}. ${d.description}.${keywords}`;
    })
    .join("\n");
  return `${loadRubric().trim()}\n\n## Domains\n\n${list}\n`;
}

function userPrompt(batch: Candidate[]): string {
  const blocks = batch.map(
    (p, i) =>
      `<paper id="p${i + 1}" domains="${p.domainIds.join(",")}">\nTitle: ${untrusted(p.title)}\nAbstract: ${untrusted(p.abstract).slice(0, ABSTRACT_MAX_CHARS)}\n</paper>`,
  );
  return `Assess these ${batch.length} papers.\n\n${blocks.join("\n\n")}`;
}

type DomainRow = {
  paper_id: string;
  domain_id: number;
  llm_relevance: number;
  novelty: number;
  signal_type: string;
  client_angle: string;
  risk_flags: string[];
};

// Candidate domains the model left out get relevance 0; papers it left out stay SHORTLISTED.
export function toDomainRows(batch: Candidate[], result: ScoreBatch): DomainRow[] {
  const rows: DomainRow[] = [];
  const seen = new Set<string>();
  for (const item of result.papers) {
    const index = Number(/^p(\d+)$/.exec(item.id.trim())?.[1]) - 1;
    const paper = batch[index];
    if (!paper || seen.has(paper.id)) continue;
    seen.add(paper.id);
    const relevance = new Map(item.domains.map((d) => [d.domainId, d.relevance]));
    const riskFlags = [...new Set(item.riskFlags.map((f) => f.trim().toLowerCase()).filter(Boolean))];
    for (const domainId of paper.domainIds) {
      rows.push({
        paper_id: paper.id,
        domain_id: domainId,
        llm_relevance: relevance.get(domainId) ?? 0,
        novelty: item.novelty,
        signal_type: item.signalType,
        client_angle: truncateWords(item.clientAngle),
        risk_flags: riskFlags,
      });
    }
  }
  return rows;
}

async function writeRows(rows: DomainRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db.execute(sql`
    update research_signal.paper_domain pd
    set llm_relevance = r.llm_relevance,
      novelty = r.novelty,
      signal_type = r.signal_type::research_signal.signal_type,
      client_angle = r.client_angle,
      risk_flags = array(select jsonb_array_elements_text(r.risk_flags)),
      scored_at = now()
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(
      paper_id uuid, domain_id int, llm_relevance smallint, novelty smallint,
      signal_type text, client_angle text, risk_flags jsonb
    )
    where pd.paper_id = r.paper_id and pd.domain_id = r.domain_id`);
  const ids = [...new Set(rows.map((r) => r.paper_id))];
  await db
    .update(papers)
    .set({ status: "SCORED" })
    .where(and(inArray(papers.id, ids), eq(papers.status, "SHORTLISTED")));
}

async function candidates(paperIds?: string[], limit = SCORE_LIMIT): Promise<Candidate[]> {
  const rows = await db
    .select({
      id: papers.id,
      title: papers.title,
      abstract: papers.abstract,
      domainIds: sql<number[]>`array_agg(${paperDomain.domainId} order by ${paperDomain.domainId})`,
    })
    .from(papers)
    .innerJoin(paperDomain, eq(paperDomain.paperId, papers.id))
    .innerJoin(domains, and(eq(domains.id, paperDomain.domainId), eq(domains.active, true)))
    .where(and(eq(papers.status, "SHORTLISTED"), paperIds ? inArray(papers.id, paperIds) : undefined))
    .groupBy(papers.id)
    .orderBy(asc(papers.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, domainIds: r.domainIds.map(Number) }));
}

export async function runScore(options: { paperIds?: string[]; limit?: number } = {}): Promise<ScoreResult> {
  const limit = Math.min(options.limit ?? SCORE_LIMIT, SCORE_LIMIT);
  const pending = await candidates(options.paperIds, limit);
  if (pending.length === 0) return { scored: 0, batches: 0, failedBatches: 0, remaining: false, ranked: 0, promoted: 0 };

  const [settings] = await db.select({ chatModel: appSettings.chatModel }).from(appSettings).where(eq(appSettings.id, 1));
  if (!settings) throw new Error("app_settings row is missing; run npm run seed");
  const active = await db
    .select({ id: domains.id, name: domains.name, description: domains.description, keywords: domains.keywords })
    .from(domains)
    .where(eq(domains.active, true))
    .orderBy(asc(domains.id));
  const system = systemPrompt(active);
  const model = chatModel(settings.chatModel, { reasoning: { effort: REASONING_EFFORT } });

  const batches: Candidate[][] = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) batches.push(pending.slice(i, i + BATCH_SIZE));

  const run = pLimit(CONCURRENCY);
  const results = await Promise.allSettled(
    batches.map((batch) =>
      run(async () => {
        const { object } = await llmCall("score", settings.chatModel, () =>
          generateObject({
            model,
            schema: ScoreBatch,
            system,
            prompt: userPrompt(batch),
            temperature: TEMPERATURE,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            maxRetries: 0,
          }),
        );
        const rows = toDomainRows(batch, object);
        await writeRows(rows);
        return new Set(rows.map((r) => r.paper_id)).size;
      }),
    ),
  );

  let scored = 0;
  const errors: unknown[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") scored += result.value;
    else errors.push(result.reason);
  }

  const touched = [...new Set(pending.flatMap((p) => p.domainIds))];
  const { ranked, promoted } = scored > 0 ? await rankAll(touched) : { ranked: 0, promoted: 0 };
  if (scored > 0) await indexPaperSummaries(pending.map((p) => p.id));

  const credits = errors.find((e) => e instanceof LlmCreditsExhausted);
  if (credits) throw credits;
  if (errors.length === batches.length) throw errors[0];

  let remaining = false;
  if (!options.paperIds) {
    const [more] = await db.select({ id: papers.id }).from(papers).where(eq(papers.status, "SHORTLISTED")).limit(1);
    remaining = Boolean(more);
    if (remaining && (scored > 0 || pending.length === limit)) await enqueue("score");
  }
  return { scored, batches: batches.length, failedBatches: errors.length, remaining, ranked, promoted };
}
