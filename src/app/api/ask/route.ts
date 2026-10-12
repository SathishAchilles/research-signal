import { randomUUID } from "node:crypto";
import {
  APICallError,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  type ModelMessage,
  RetryError,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { appSettings, askMessages, askThreads, domains, llmCalls } from "@/db/schema";
import {
  type AskCitation,
  type AskCoverage,
  type AskEvidence,
  type AskMetadata,
  citedRefs,
  coverageLine,
  fillEvidenceTokens,
  formatCount,
  validateAnswer,
  withVerdictConfidence,
} from "@/lib/ask/answer";
import { type Confidence, confidence } from "@/lib/ask/grade";
import { playbookFor, systemPrompt } from "@/lib/ask/playbooks";
import { type RoutedIntent, routeIntent } from "@/lib/ask/route-intent";
import { type AskContext, type AskTools, askTools, citationOf, createAskContext, initialSearch, stageFor } from "@/lib/ask/tools";
import { LlmCreditsExhausted, llmCall } from "@/lib/llm/call";
import { chatModel } from "@/lib/llm/openrouter";
import { upsertSearchDoc } from "@/lib/search/index";

export const maxDuration = 300;

const MAX_STEPS = 6;
// Tool rounds the model may spend before it must write; the first search and the top cards are preloaded.
const TOOL_ROUNDS = 2;
// Thinking budget per step. It counts against maxOutputTokens, so the answer budget is added on top.
const REASONING_TOKENS = 512;
const TOKENS_PER_WORD = 2;
const HISTORY_MESSAGES = 6;
const REPAIR_DATA_CHARS = 30_000;
const CREDITS = "llm_credits_exhausted";

const BodySchema = z.object({
  threadId: z.uuid().optional(),
  prompt: z.string().trim().min(1).max(2000),
});

type AskUIMessage = UIMessage<AskMetadata>;

type Finished = {
  content: string;
  citations: AskCitation[];
  confidence: Confidence;
  coverage: AskCoverage & { warning?: string; errors?: string[] };
};

async function indexCoverage() {
  const [row] = await db.execute<{ n: number; from: string | null; to: string | null }>(sql`
    select count(*)::int as n, min(published_at) as from, max(published_at) as to
    from research_signal.search_docs where entity_type = 'paper'`);
  return {
    indexed: Number(row?.n ?? 0),
    from: row?.from ? new Date(row.from).toISOString().slice(0, 10) : null,
    to: row?.to ? new Date(row.to).toISOString().slice(0, 10) : null,
    firstIndexedAt: row?.from ? new Date(row.from) : null,
  };
}

async function loadSettings() {
  const [row] = await db
    .select({ chatModel: appSettings.chatModel, wordCap: appSettings.proseWordCap })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  if (!row) throw new Error("app_settings row is missing; run npm run seed");
  return row;
}

async function history(threadId: string | undefined): Promise<ModelMessage[]> {
  if (!threadId) return [];
  const rows = await db
    .select({ role: askMessages.role, content: askMessages.content })
    .from(askMessages)
    .where(eq(askMessages.threadId, threadId))
    .orderBy(desc(askMessages.createdAt))
    .limit(HISTORY_MESSAGES);
  // Earlier refs belong to earlier tool calls, so they are dropped from the history.
  return rows.reverse().map((m) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: m.content.replace(/\[p\d+\]/g, ""),
  }));
}

async function threadTitle(threadId: string | undefined): Promise<string | null> {
  if (!threadId) return null;
  const [thread] = await db.select({ title: askThreads.title }).from(askThreads).where(eq(askThreads.id, threadId));
  return thread?.title ?? null;
}

async function domainNamesOf(ids: number[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.select({ name: domains.name }).from(domains).where(inArray(domains.id, ids)).orderBy(asc(domains.id));
  return rows.map((d) => d.name);
}

function evidenceOf(ctx: AskContext): AskEvidence {
  return Object.fromEntries([...ctx.refs.values()].map((r) => [r.ref, r.evidence]));
}

function citationsOf(ctx: AskContext, text: string): AskCitation[] {
  return citedRefs(text).flatMap((ref) => {
    const entry = ctx.refs.get(ref);
    return entry ? [citationOf(entry)] : [];
  });
}

function grade(ctx: AskContext, text: string): Confidence {
  const cited = citedRefs(text)
    .map((ref) => ctx.refs.get(ref))
    .filter((r) => r !== undefined);
  const relevant = cited.length > 0 ? cited : [...ctx.refs.values()].filter((r) => r.relevant);
  return confidence(relevant);
}

function coverageOf(base: Awaited<ReturnType<typeof indexCoverage>>, ctx: AskContext): AskCoverage {
  const c = { indexed: base.indexed, from: base.from, to: base.to, live: { used: ctx.live.used, found: ctx.live.found } };
  return { ...c, line: coverageLine(c) };
}

function statusOf(error: unknown): number | undefined {
  const inner = RetryError.isInstance(error) ? error.lastError : error;
  return APICallError.isInstance(inner) ? inner.statusCode : undefined;
}

function isCreditsError(error: unknown): boolean {
  return error instanceof LlmCreditsExhausted || statusOf(error) === 402;
}

// The text of a stream error part; the panel maps CREDITS to its own message.
function errorText(error: unknown): string {
  if (isCreditsError(error)) return CREDITS;
  console.error(`ask failed: ${error instanceof Error ? error.message : String(error)}`);
  return "The answer failed. Try again.";
}

async function repair(
  model: string,
  system: string,
  draft: string,
  errors: string[],
  ctx: AskContext,
): Promise<string> {
  const refs = [...ctx.refs.values()].map((r) => `${r.ref}: ${r.title}`).join("\n");
  const data = ctx.retrieved.join("\n").slice(0, REPAIR_DATA_CHARS);
  const { text } = await llmCall(stageFor(ctx, "ask_repair"), model, () =>
    generateText({
      model: chatModel(model),
      system,
      prompt: [
        "Your draft answer failed these checks:",
        ...errors.map((e) => `- ${e}`),
        "",
        "Rewrite the whole answer so every check passes. Keep the template, keep only citations from the list of known refs, and copy numbers only from the retrieved data about the papers you cite. Return only the answer.",
        "",
        `<known_refs>\n${refs}\n</known_refs>`,
        `<untrusted_retrieved_data>\n${data}\n</untrusted_retrieved_data>`,
        `<draft>\n${draft}\n</draft>`,
      ].join("\n"),
      temperature: 0.2,
      maxRetries: 0,
      providerOptions: { openrouter: { reasoning: { effort: "minimal" } } },
    }),
  );
  return text.trim();
}

async function finish(args: {
  draft: string;
  ctx: AskContext;
  isBet: boolean;
  model: string;
  system: string;
  wordCap: number;
  context: string;
  coverageBase: Awaited<ReturnType<typeof indexCoverage>>;
}): Promise<Finished> {
  const { ctx, model, system, wordCap } = args;
  const check = (text: string) =>
    validateAnswer(text, {
      knownRefs: new Set(ctx.refs.keys()),
      evidence: evidenceOf(ctx),
      paperData: Object.fromEntries([...ctx.refs.values()].map((r) => [r.ref, r.data.join("\n")])),
      context: args.context,
      wordCap,
    });

  let text = args.draft.trim();
  let errors = check(text);
  let warning: string | undefined;
  if (errors.length > 0) {
    console.warn(`ask draft failed ${errors.length} checks: ${errors.slice(0, 5).join("; ")}`);
    try {
      const repaired = await repair(model, system, text, errors, ctx);
      const repairedErrors = check(repaired);
      if (repaired && repairedErrors.length < errors.length) {
        text = repaired;
        errors = repairedErrors;
      }
    } catch (error) {
      console.error(`ask repair failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (errors.length > 0) warning = "This answer did not pass every evidence check; verify the cited papers before using it.";
  }

  const graded = grade(ctx, text);
  if (args.isBet) text = withVerdictConfidence(text, graded);
  const coverage = coverageOf(args.coverageBase, ctx);
  return {
    content: fillEvidenceTokens(text, evidenceOf(ctx)),
    citations: citationsOf(ctx, text),
    confidence: graded,
    coverage: { ...coverage, ...(warning ? { warning, errors } : {}) },
  };
}

// Only this request's calls: their llm_calls rows carry its id (scripts/sql/009).
async function requestCost(requestId: string): Promise<number | null> {
  const [row] = await db.execute<{ cost: number | null }>(sql`
    select sum(cost_usd)::float8 as cost from research_signal.llm_calls where request_id = ${requestId}::uuid`);
  return row?.cost === null || row?.cost === undefined ? null : Number(row.cost);
}

// The thread, the question and the answer are written together, so a failed answer leaves no rows.
async function save(args: {
  threadId: string;
  newThread: boolean;
  messageId: string;
  title: string;
  prompt: string;
  routed: RoutedIntent;
  finished: Finished;
  started: Date;
}) {
  const { threadId, messageId, finished, routed } = args;
  const costUsd = await requestCost(messageId);
  await db.transaction(async (tx) => {
    if (args.newThread) await tx.insert(askThreads).values({ id: threadId, title: args.title });
    await tx.insert(askMessages).values({ threadId, role: "user", content: args.prompt, createdAt: args.started });
    await tx.insert(askMessages).values({
      id: messageId,
      threadId,
      role: "assistant",
      content: finished.content,
      intent: routed.bareTerm ? "EXPLAIN+CATCHUP" : routed.intent,
      citations: finished.citations,
      confidence: finished.confidence,
      coverage: finished.coverage,
      costUsd,
    });
  });
}

// Indexing embeds the answer, so it runs after the finish part has been sent.
async function indexAnswer(args: { messageId: string; title: string; routed: RoutedIntent; finished: Finished }) {
  const { messageId, finished, routed } = args;
  try {
    await upsertSearchDoc({
      entityType: "answer",
      entityId: messageId,
      title: args.title,
      body: finished.content,
      facets: { domainIds: routed.domains, source: "ask", publishedAt: new Date() },
    });
  } catch (error) {
    console.error(`ask answer indexing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function preface(coverage: Awaited<ReturnType<typeof indexCoverage>>, strong: number, routed: RoutedIntent): string {
  const since = routed.since ? ` since ${routed.since}` : "";
  return `_Searched ${formatCount(coverage.indexed)} indexed papers${since}: ${strong} close matches. Writing the answer…_\n\n`;
}

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { prompt } = parsed.data;
  const started = new Date();
  // One id for the answer row and for this request's llm_calls rows.
  const messageId = randomUUID();
  const newThread = !parsed.data.threadId;
  const threadId = parsed.data.threadId ?? randomUUID();

  // Everything that can fail before the answer starts runs here, so failures are plain JSON
  // responses and no thread or message rows are written.
  let prepared;
  try {
    const [routed, coverageBase, settings, past, existingTitle] = await Promise.all([
      routeIntent(prompt, started, messageId),
      indexCoverage(),
      loadSettings(),
      history(parsed.data.threadId),
      threadTitle(parsed.data.threadId),
    ]);
    if (!newThread && existingTitle === null) return NextResponse.json({ error: "Unknown thread" }, { status: 404 });
    const ctx = createAskContext(routed, coverageBase.firstIndexedAt, messageId);
    const [first, domainNames] = await Promise.all([
      initialSearch(ctx, routed.entities.join(" ") || prompt),
      domainNamesOf(routed.domains),
    ]);
    prepared = { routed, coverageBase, settings, past, title: existingTitle ?? prompt.slice(0, 120), ctx, first, domainNames };
  } catch (error) {
    if (isCreditsError(error)) return NextResponse.json({ error: CREDITS }, { status: 402 });
    console.error(`ask failed before streaming: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json({ error: "ask_failed" }, { status: 500 });
  }
  const { routed, coverageBase, settings, past, title, ctx, first, domainNames } = prepared;

  const { intents, tools: names, template } = playbookFor(routed);
  const all = askTools(ctx);
  const tools = Object.fromEntries(names.map((name) => [name, all[name]])) as Partial<AskTools>;
  const today = started.toISOString().slice(0, 10);
  const systemFor = () =>
    systemPrompt(routed, template, intents, {
      wordCap: settings.wordCap,
      domainNames,
      today,
      toolRounds: TOOL_ROUNDS,
      confidence: confidence([...ctx.refs.values()].filter((r) => r.relevant)),
    });
  const model = settings.chatModel;
  const intentLabel = intents.join("+");
  const userContent = [
    prompt,
    "",
    `<search_index_result input='${JSON.stringify(first.input)}'>`,
    JSON.stringify(first.output),
    "</search_index_result>",
    "<get_papers_result>",
    JSON.stringify({ papers: first.papers }),
    "</get_papers_result>",
  ].join("\n");
  // Numbers that do not belong to one paper: the question, its dates, the template and trend output.
  const context = () => [prompt, today, routed.since ?? "", template, ...ctx.aggregates].join("\n");

  const stream = createUIMessageStream<AskUIMessage>({
    onError: errorText,
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageMetadata: { threadId, messageId, intent: intentLabel } });
      // A short preface goes out before the model starts; the saved answer does not include it.
      const prefaceId = `preface-${messageId}`;
      writer.write({ type: "text-start", id: prefaceId });
      writer.write({ type: "text-delta", id: prefaceId, delta: preface(coverageBase, first.output.strongHits, routed) });
      writer.write({ type: "text-end", id: prefaceId });

      let streamError: unknown;
      const logged: Promise<unknown>[] = [];
      const result = streamText({
        model: chatModel(model, { reasoning: { max_tokens: REASONING_TOKENS } }),
        system: systemFor(),
        messages: [...past, { role: "user", content: userContent }],
        tools,
        stopWhen: stepCountIs(MAX_STEPS),
        // After TOOL_ROUNDS rounds the model may not call tools, so it writes; the system prompt is
        // rebuilt each step so the confidence it is given reflects the papers found so far.
        prepareStep: ({ stepNumber }) => ({
          system: systemFor(),
          ...(stepNumber >= TOOL_ROUNDS ? { toolChoice: "none" as const } : {}),
        }),
        maxOutputTokens: REASONING_TOKENS + settings.wordCap * TOKENS_PER_WORD,
        temperature: 0.3,
        maxRetries: 1,
        onStepFinish: (step) => {
          logged.push(llmCall(stageFor(ctx, "ask"), model, async () => step).catch(() => undefined));
        },
        onError: ({ error }) => {
          streamError = error;
          if (statusOf(error) === 402) {
            logged.push(db.insert(llmCalls).values({ stage: stageFor(ctx, "ask"), model, status: "credits_exhausted" }).catch(() => undefined));
          }
        },
      });

      let draft = "";
      for await (const chunk of result.toUIMessageStream<AskUIMessage>({
        sendStart: false,
        sendFinish: false,
        sendReasoning: false,
        onError: errorText,
      })) {
        if (chunk.type === "text-delta") draft += chunk.delta;
        writer.write(chunk);
      }
      await Promise.all(logged);
      // The stream already carries the error part; nothing is saved for a failed answer.
      if (streamError !== undefined) return;

      const finished = await finish({
        draft,
        ctx,
        isBet: intents.includes("BET"),
        model,
        system: systemFor(),
        wordCap: settings.wordCap,
        context: context(),
        coverageBase,
      });
      await save({ threadId, newThread, messageId, title, prompt, routed, finished, started });
      writer.write({
        type: "finish",
        messageMetadata: {
          threadId,
          messageId,
          intent: intentLabel,
          confidence: finished.confidence,
          coverage: finished.coverage,
          citations: finished.citations,
          evidence: evidenceOf(ctx),
        },
      });
      await indexAnswer({ messageId, title, routed, finished });
    },
  });

  return createUIMessageStreamResponse({ stream });
}

// Messages of one thread, for reloading the saved (validated) answer after streaming.
export async function GET(request: NextRequest) {
  const parsed = z.uuid().safeParse(request.nextUrl.searchParams.get("threadId"));
  if (!parsed.success) return NextResponse.json({ error: "threadId must be a uuid" }, { status: 400 });
  const messages = await db
    .select({
      id: askMessages.id,
      role: askMessages.role,
      content: askMessages.content,
      intent: askMessages.intent,
      citations: askMessages.citations,
      confidence: askMessages.confidence,
      coverage: askMessages.coverage,
      createdAt: askMessages.createdAt,
    })
    .from(askMessages)
    .where(eq(askMessages.threadId, parsed.data))
    .orderBy(asc(askMessages.createdAt));
  return NextResponse.json({ messages });
}
