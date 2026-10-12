import { randomUUID } from "node:crypto";
import { generateText, type ModelMessage, stepCountIs, streamText, type UIMessage } from "ai";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
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
  validateAnswer,
} from "@/lib/ask/answer";
import { type Confidence, confidence } from "@/lib/ask/grade";
import { playbookFor, systemPrompt } from "@/lib/ask/playbooks";
import { type RoutedIntent, routeIntent } from "@/lib/ask/route-intent";
import { type AskContext, type AskTools, askTools, createAskContext, initialSearch } from "@/lib/ask/tools";
import { LlmCreditsExhausted, llmCall } from "@/lib/llm/call";
import { chatModel } from "@/lib/llm/openrouter";
import { upsertSearchDoc } from "@/lib/search/index";

export const maxDuration = 300;

const MAX_STEPS = 6;
const HISTORY_MESSAGES = 6;
const REPAIR_DATA_CHARS = 30_000;
const COST_STAGES = ["ask_route", "ask", "ask_repair", "search_query"];

const BodySchema = z.object({
  threadId: z.uuid().optional(),
  prompt: z.string().trim().min(1).max(2000),
});

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

function evidenceOf(ctx: AskContext): AskEvidence {
  return Object.fromEntries([...ctx.refs.values()].map((r) => [r.ref, r.evidence]));
}

function citationsOf(ctx: AskContext, text: string): AskCitation[] {
  return citedRefs(text).flatMap((ref) => {
    const entry = ctx.refs.get(ref);
    return entry ? [{ ref, paperId: entry.paperId, title: entry.title, rung: entry.rung }] : [];
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

async function repair(model: string, system: string, draft: string, errors: string[], ctx: AskContext): Promise<string> {
  const refs = [...ctx.refs.values()].map((r) => `${r.ref}: ${r.title}`).join("\n");
  const data = ctx.retrieved.join("\n").slice(0, REPAIR_DATA_CHARS);
  const { text } = await llmCall("ask_repair", model, () =>
    generateText({
      model: chatModel(model),
      system,
      prompt: [
        "Your draft answer failed these checks:",
        ...errors.map((e) => `- ${e}`),
        "",
        "Rewrite the whole answer so every check passes. Keep the template, keep only citations from the list of known refs, and copy numbers only from the retrieved data. Return only the answer.",
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
  prompt: string;
  model: string;
  system: string;
  wordCap: number;
  coverageBase: Awaited<ReturnType<typeof indexCoverage>>;
}): Promise<Finished> {
  const { ctx, prompt, model, system, wordCap } = args;
  const check = (text: string) =>
    validateAnswer(text, {
      knownRefs: new Set(ctx.refs.keys()),
      evidence: evidenceOf(ctx),
      retrieved: ctx.retrieved.join("\n"),
      prompt,
      wordCap,
    });

  let text = args.draft.trim();
  let errors = check(text);
  let warning: string | undefined;
  if (errors.length > 0) {
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

  const coverage = coverageOf(args.coverageBase, ctx);
  return {
    content: fillEvidenceTokens(text, evidenceOf(ctx)),
    citations: citationsOf(ctx, text),
    confidence: grade(ctx, text),
    coverage: { ...coverage, ...(warning ? { warning, errors } : {}) },
  };
}

async function requestCost(started: Date): Promise<number | null> {
  const [row] = await db
    .select({ cost: sql<number | null>`sum(${llmCalls.costUsd})` })
    .from(llmCalls)
    .where(and(gte(llmCalls.createdAt, started), inArray(llmCalls.stage, COST_STAGES)));
  return row?.cost === null || row?.cost === undefined ? null : Number(row.cost);
}

async function save(args: {
  threadId: string;
  messageId: string;
  title: string;
  routed: RoutedIntent;
  finished: Finished;
  started: Date;
}) {
  const { threadId, messageId, finished, routed } = args;
  await db.insert(askMessages).values({
    id: messageId,
    threadId,
    role: "assistant",
    content: finished.content,
    intent: routed.bareTerm ? "EXPLAIN+CATCHUP" : routed.intent,
    citations: finished.citations,
    confidence: finished.confidence,
    coverage: finished.coverage,
    costUsd: await requestCost(args.started),
  });
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

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { prompt } = parsed.data;
  const started = new Date();

  let routed: RoutedIntent;
  let coverageBase: Awaited<ReturnType<typeof indexCoverage>>;
  let settings: Awaited<ReturnType<typeof loadSettings>>;
  let past: ModelMessage[];
  try {
    [routed, coverageBase, settings, past] = await Promise.all([
      routeIntent(prompt, started),
      indexCoverage(),
      loadSettings(),
      history(parsed.data.threadId),
    ]);
  } catch (error) {
    if (error instanceof LlmCreditsExhausted) {
      return NextResponse.json({ error: "llm_credits_exhausted" }, { status: 402 });
    }
    throw error;
  }

  let threadId = parsed.data.threadId;
  let title = prompt.slice(0, 120);
  if (threadId) {
    const [thread] = await db.select({ title: askThreads.title }).from(askThreads).where(eq(askThreads.id, threadId));
    if (!thread) return NextResponse.json({ error: "Unknown thread" }, { status: 404 });
    title = thread.title;
  } else {
    const [thread] = await db.insert(askThreads).values({ title }).returning({ id: askThreads.id });
    threadId = thread.id;
  }
  await db.insert(askMessages).values({ threadId, role: "user", content: prompt });

  const ctx = createAskContext(routed, coverageBase.firstIndexedAt);
  const { intents, tools: names, template } = playbookFor(routed);
  const all = askTools(ctx);
  const tools = Object.fromEntries(names.map((name) => [name, all[name]])) as Partial<AskTools>;
  const domainNames = routed.domains.length
    ? (await db.select({ name: domains.name }).from(domains).where(inArray(domains.id, routed.domains)).orderBy(asc(domains.id))).map(
        (d) => d.name,
      )
    : [];
  const system = systemPrompt(routed, template, intents, {
    wordCap: settings.wordCap,
    domainNames,
    today: started.toISOString().slice(0, 10),
  });
  const model = settings.chatModel;
  const messageId = randomUUID();
  const intentLabel = intents.join("+");
  let draft = "";
  const first = await initialSearch(ctx, routed.entities.join(" ") || prompt);
  const userContent = [
    prompt,
    "",
    `<search_index_result input='${JSON.stringify(first.input)}'>`,
    JSON.stringify(first.output),
    "</search_index_result>",
  ].join("\n");

  const result = streamText({
    model: chatModel(model),
    system,
    messages: [...past, { role: "user", content: userContent }],
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    // The last step may not call tools, so the answer is always written.
    prepareStep: ({ stepNumber }) => (stepNumber >= MAX_STEPS - 1 ? { toolChoice: "none" as const } : undefined),
    temperature: 0.3,
    maxRetries: 1,
    providerOptions: { openrouter: { reasoning: { effort: "minimal" } } },
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") draft += chunk.text;
    },
    onStepFinish: async (step) => {
      await llmCall("ask", model, async () => step);
    },
    onError: ({ error }) => {
      console.error(`ask stream failed: ${error instanceof Error ? error.message : String(error)}`);
    },
    onFinish: async ({ text }) => {
      const finished = await finish({ draft: text || draft, ctx, prompt, model, system, wordCap: settings.wordCap, coverageBase });
      await save({ threadId, messageId, title, routed, finished, started });
    },
  });

  return result.toUIMessageStreamResponse<UIMessage<AskMetadata>>({
    sendReasoning: false,
    messageMetadata: ({ part }): AskMetadata | undefined => {
      if (part.type === "start") return { threadId, messageId, intent: intentLabel };
      if (part.type !== "finish") return undefined;
      const coverage = coverageOf(coverageBase, ctx);
      return {
        threadId,
        messageId,
        intent: intentLabel,
        confidence: grade(ctx, draft),
        coverage,
        citations: citationsOf(ctx, draft),
        evidence: evidenceOf(ctx),
      };
    },
  });
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
