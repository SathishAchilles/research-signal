"use client";

import { Chat, useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PaperFigure, figureAttribution, isServableFigure } from "@/components/paper/PaperFigure";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  type AskCitation,
  type AskCoverage,
  type AskMetadata,
  type InlineToken,
  type ListBlock,
  TOKEN,
  asClientMarkdown,
  dropConfidenceLines,
  fillEvidenceTokens,
  inlineTokens,
  parseBlocks,
} from "@/lib/ask/answer";
import type { SignalType } from "@/lib/pipeline/rank";
import { cn } from "@/lib/utils";

type AskMessage = UIMessage<AskMetadata>;

export type SavedAskMessage = {
  id: string;
  role: string;
  content: string;
  intent: string | null;
  citations: unknown;
  confidence: string | null;
  coverage: unknown;
};

export const JOB_PROMPTS = [
  { label: "Bet", prompt: "Should a client bet on mixture-of-agents?" },
  { label: "Backing", prompt: "Does research back LLM-based visual quality inspection for a manufacturer?" },
  { label: "Direction", prompt: "Where is agent evaluation heading?" },
  { label: "Explain", prompt: "agentic RAG" },
  { label: "Catch up", prompt: "What's new in RAG since 1 Oct?" },
  { label: "Prep", prompt: "Prep me for Acme on vision quality inspection" },
];

type Coverage = AskCoverage & { warning?: string };

// A cited paper's lead figure, loaded by the page for the thumbnails in the citation list, with the
// attribution fields and the signal type the glyph fallback draws.
export type CitedFigure = {
  figureUrl: string | null;
  caption: string | null;
  signalType: SignalType | null;
  arxivId: string | null;
  authors: string[];
};
export type CitedFigures = Record<string, CitedFigure>;

const THUMB = 56;
const NO_CITES = new Map<string, AskCitation>();

function toUiMessage(m: SavedAskMessage, threadId: string): AskMessage {
  return {
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    parts: [{ type: "text", text: m.content }],
    metadata: {
      threadId,
      messageId: m.id,
      intent: m.intent ?? "",
      confidence: (m.confidence as AskMetadata["confidence"]) ?? undefined,
      coverage: (m.coverage as Coverage | null) ?? undefined,
      citations: Array.isArray(m.citations) ? (m.citations as AskCitation[]) : [],
      evidence: {},
    },
  };
}

function textOf(message: AskMessage): string {
  return message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

function displayText(message: AskMessage): string {
  const text = textOf(message);
  const evidence = message.metadata?.evidence;
  if (evidence && Object.keys(evidence).length) return fillEvidenceTokens(text, evidence);
  return text.replace(TOKEN, "…");
}

function citationMap(message: AskMessage): Map<string, AskCitation> {
  return new Map((message.metadata?.citations ?? []).map((c) => [c.ref, c]));
}

// Inline Markdown tokens as JSX: [pN] citations link to the paper page, and a run of 4+ adjacent
// citations shows its first three plus a "+N" chip (the full list is in Cited papers below).
function renderInline(tokens: InlineToken[], cites: Map<string, AskCitation>, key = ""): ReactNode[] {
  const cite = (ref: string, k: string) => {
    const c = cites.get(ref);
    return c ? (
      <Link key={k} href={`/paper/${c.paperId}`} title={c.title} className="text-primary underline underline-offset-2">
        [{ref}]
      </Link>
    ) : (
      <span key={k} className="text-muted-foreground">[{ref}]</span>
    );
  };
  return tokens.map((t, i) => {
    const k = `${key}${i}`;
    switch (t.kind) {
      case "text":
        return <Fragment key={k}>{t.text}</Fragment>;
      case "bold":
        return <strong key={k}>{renderInline(t.children, cites, `${k}.`)}</strong>;
      case "italic":
        return <em key={k}>{renderInline(t.children, cites, `${k}.`)}</em>;
      case "code":
        return <code key={k} className="rounded bg-plate-hover px-1 font-mono text-[0.85em]">{t.text}</code>;
      case "math":
        return (
          <span key={k} data-math="" className="font-mono text-[0.9em]">
            {t.parts.map((p, j) =>
              p.kind === "sub" ? <sub key={j}>{p.text}</sub> : p.kind === "sup" ? <sup key={j}>{p.text}</sup> : <Fragment key={j}>{p.text}</Fragment>,
            )}
          </span>
        );
      case "cite":
        return cite(t.ref, k);
      case "citeRun":
        return (
          <Fragment key={k}>
            {t.shown.map((ref, j) => cite(ref, `${k}-${j}`))}
            <span
              data-cite-more=""
              title={t.hidden.map((ref) => `[${ref}] ${cites.get(ref)?.title ?? ""}`.trim()).join("\n")}
              className="ml-0.5 rounded-full bg-plate-hover px-1.5 py-px align-baseline font-mono text-[11px] text-muted-foreground"
            >
              <span aria-hidden="true">+{t.hidden.length}</span>
              <span className="sr-only">and {t.hidden.length} more citations: {t.hidden.join(", ")}</span>
            </span>
          </Fragment>
        );
    }
  });
}

function inline(text: string, cites: Map<string, AskCitation>): ReactNode[] {
  return renderInline(inlineTokens(text), cites);
}

// Answer headings sit under the page's h1, so a Markdown level n becomes h(n+1), sized by level.
const HEADING_TAG = ["h2", "h3", "h4", "h5", "h6", "h6"] as const;
const HEADING_SIZE = [
  "mt-4 text-xl",
  "mt-4 text-lg",
  "mt-3 text-base",
  "mt-2 text-sm",
  "mt-2 text-sm text-muted-foreground",
  "mt-2 text-sm text-muted-foreground",
];

function MarkdownList({ list, cites }: { list: ListBlock; cites: Map<string, AskCitation> }) {
  const items = list.items.map((item, j) => (
    <li key={j} className="pl-1">
      {inline(item.text, cites)}
      {item.children ? <MarkdownList list={item.children} cites={cites} /> : null}
    </li>
  ));
  return list.ordered ? (
    <ol start={list.start} className="flex list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground">
      {items}
    </ol>
  ) : (
    <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-muted-foreground">{items}</ul>
  );
}

function Markdown({ text, cites }: { text: string; cites: Map<string, AskCitation> }) {
  const blocks = parseBlocks(text).map((block, i): ReactNode => {
    switch (block.type) {
      case "hr":
        return <hr key={i} className="my-2 border-border" />;
      case "heading": {
        const Tag = HEADING_TAG[block.level - 1];
        return (
          <Tag key={i} className={cn("font-heading font-semibold", HEADING_SIZE[block.level - 1])}>
            {inline(block.text, cites)}
          </Tag>
        );
      }
      case "table":
        return (
          <div key={i} className="overflow-x-auto">
            <table className="my-2 w-full text-left text-sm tabular-nums">
              <thead>
                <tr>{block.head.map((c, j) => <th key={j} className="border-b border-border py-1 pr-3 font-medium">{inline(c, cites)}</th>)}</tr>
              </thead>
              <tbody>
                {block.rows.map((r, k) => (
                  <tr key={k}>{r.map((c, j) => <td key={j} className="border-b border-border py-1 pr-3 align-top">{inline(c, cites)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "list":
        return <MarkdownList key={i} list={block} cites={cites} />;
      case "note":
        return (
          <p key={i} className="italic text-muted-foreground">
            {inline(block.text, cites)}
          </p>
        );
      case "p":
        return <p key={i}>{inline(block.text, cites)}</p>;
    }
  });
  return <div className="flex flex-col gap-1.5 text-sm leading-6">{blocks}</div>;
}

function asMarkdown(message: AskMessage, title: string, figures: CitedFigures): string {
  const meta = message.metadata;
  return asClientMarkdown({
    title,
    text: displayText(message),
    confidence: meta?.confidence,
    coverageLine: meta?.coverage?.line,
    citations: [...citationMap(message).values()],
    fallback: figures,
  });
}

type SaveResult = "added" | "upgraded" | "noted" | "already";

function saveSummary(results: PromiseSettledResult<SaveResult>[]): string {
  const count = (kind: SaveResult) => results.filter((r) => r.status === "fulfilled" && r.value === kind).length;
  const plural = (n: number) => (n === 1 ? "paper" : "papers");
  const added = count("added") + count("upgraded");
  const already = count("noted") + count("already");
  const failed = results.filter((r) => r.status === "rejected").length;
  const parts = [`Added ${added} ${plural(added)} to the log as Share with clients`];
  if (count("upgraded")) parts[0] += ` (${count("upgraded")} upgraded from Read)`;
  if (already) parts.push(`${already} already logged${count("noted") ? ", note appended" : ""}`);
  if (failed) parts.push(`${failed} failed`);
  return `${parts.join("; ")}.`;
}

// Copy, Export and Save to log, shown by the badges at the top of the answer and again at its end.
function AnswerActions({
  message,
  title,
  figures,
  onStatus,
  className,
}: {
  message: AskMessage;
  title: string;
  figures: CitedFigures;
  onStatus: (status: string) => void;
  className?: string;
}) {
  const [saving, setSaving] = useState(false);
  const cites = [...citationMap(message).values()];

  async function copy() {
    try {
      await navigator.clipboard.writeText(asMarkdown(message, title, figures));
      onStatus("Copied as a client note.");
    } catch {
      onStatus("Copy failed: the browser blocked clipboard access. Use Export .md instead.");
    }
  }

  function exportMd() {
    const blob = new Blob([asMarkdown(message, title, figures)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "answer"}.md`;
    a.click();
    URL.revokeObjectURL(url);
    onStatus("Exported as Markdown.");
  }

  // merge: papers already in the log keep their action (Skip and Share with clients stay as they
  // are, Read is upgraded), and the "From Ask" line is appended to an existing note, never replacing it.
  async function saveToLog() {
    setSaving(true);
    onStatus("Saving…");
    const note = `From Ask: ${title}`.slice(0, 4000);
    const results = await Promise.allSettled(
      cites.map(async (c): Promise<SaveResult> => {
        const r = await fetch("/api/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paperId: c.paperId, action: "CLIENT", note, origin: "ask", merge: true }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as { saved?: SaveResult };
        return body.saved ?? "added";
      }),
    );
    setSaving(false);
    onStatus(saveSummary(results));
  }

  const button = "touch:min-h-11 touch:px-3";
  return (
    <div data-answer-actions="" className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button size="sm" variant="outline" className={button} onClick={copy}>Copy as client note</Button>
      <Button size="sm" variant="outline" className={button} onClick={exportMd}>Export .md</Button>
      <Button size="sm" variant="outline" className={button} onClick={saveToLog} disabled={cites.length === 0 || saving}>
        {saving ? "Saving…" : "Save to log"}
      </Button>
    </div>
  );
}

// The answer's cited papers as rows with a 56px figure thumbnail. Papers with no figure (or not
// loaded yet, while the answer streams) keep the same box with the signal-type glyph. The thumbnail
// has no caption plate, so an image's attribution sits in the row's text column instead.
function CitedPapers({ cites, figures }: { cites: AskCitation[]; figures: CitedFigures }) {
  if (cites.length === 0) return null;
  const sorted = [...cites].sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)));
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="micro">Cited papers</p>
      <ol aria-label="Cited papers" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {sorted.map((c) => {
          const figure = figures[c.paperId];
          const attribution = isServableFigure(figure?.figureUrl)
            ? figureAttribution(figure.authors, figure.arxivId)
            : null;
          return (
            <li key={c.ref}>
              <Link
                href={`/paper/${c.paperId}`}
                className="group flex items-center gap-3 rounded-tile bg-plate-hover p-1.5 pr-3 transition-colors hover:bg-plate-solid"
              >
                <PaperFigure
                  paperId={c.paperId}
                  arxivId={figure?.arxivId ?? null}
                  figureUrl={figure?.figureUrl ?? null}
                  caption={figure?.caption}
                  authors={figure?.authors ?? []}
                  signalType={figure?.signalType ?? null}
                  title={c.title}
                  width={THUMB}
                  height={THUMB}
                  showCaption={false}
                  linked={false}
                  className="shrink-0"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="line-clamp-2 text-sm leading-5 text-foreground group-hover:underline">
                    <span className="mr-1 font-mono text-primary">[{c.ref}]</span>
                    {inline(c.title, NO_CITES)}
                  </span>
                  {c.rung ? <span className="micro text-[10px]">{c.rung}</span> : null}
                  {attribution ? (
                    <span className="truncate font-mono text-[10.5px] tracking-[.02em] text-muted-foreground">{attribution}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Answer({
  message,
  title,
  streaming,
  figures,
}: {
  message: AskMessage;
  title: string;
  streaming: boolean;
  figures: CitedFigures;
}) {
  const meta = message.metadata;
  const cites = useMemo(() => citationMap(message), [message]);
  const coverage = meta?.coverage as Coverage | undefined;
  const [status, setStatus] = useState<string | null>(null);
  const raw = displayText(message);
  // The confidence badge already states it, so a body line that only repeats it is dropped.
  const text = meta?.confidence ? dropConfidenceLines(raw) : raw;
  const done = !streaming && Boolean(text.trim());
  return (
    <div className="plate flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {meta?.intent ? (
          <Badge variant="outline" className="glass-chip micro h-6 px-2.5 text-micro">
            {meta.intent}
          </Badge>
        ) : null}
        {meta?.confidence ? (
          <Badge
            variant={meta.confidence === "Low" ? "destructive" : "secondary"}
            className={cn(
              "micro h-6 px-2.5",
              meta.confidence === "Low" ? "text-destructive" : "glass-chip",
              meta.confidence === "High" && "text-signal",
            )}
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            Confidence: {meta.confidence}
          </Badge>
        ) : null}
        {streaming ? <span className="micro">Working…</span> : null}
        {done ? (
          <AnswerActions message={message} title={title} figures={figures} onStatus={setStatus} className="sm:ml-auto" />
        ) : null}
      </div>
      {meta?.confidence === "Low" ? (
        <p className="rounded-tile bg-destructive/10 px-3 py-2 text-sm text-destructive">Thin evidence: treat this answer as a lead, not a conclusion.</p>
      ) : null}
      {coverage?.warning ? <p className="rounded-tile bg-plate-hover px-3 py-2 text-sm">{coverage.warning}</p> : null}
      {text ? <Markdown text={text} cites={cites} /> : streaming ? <p className="text-sm text-muted-foreground">Searching…</p> : null}
      {coverage?.line ? <p className="font-mono text-[11px] leading-4 tracking-wide text-micro">{coverage.line}</p> : null}
      {!streaming || cites.size ? <CitedPapers cites={[...cites.values()]} figures={figures} /> : null}
      {done ? <AnswerActions message={message} title={title} figures={figures} onStatus={setStatus} className="pt-2" /> : null}
      {/* One live region for both action rows; sonner's Toaster is not mounted in the layout. */}
      <p
        role="status"
        aria-live="polite"
        data-answer-status=""
        className={cn(
          "self-start rounded-full bg-plate-hover px-3 py-1 text-xs text-foreground",
          !status && "sr-only",
        )}
      >
        {status ?? ""}
      </p>
    </div>
  );
}

// A 402 arrives as a JSON body (before streaming) or as the stream's error text.
function errorMessage(error: Error): string {
  if (error.message.includes("llm_credits_exhausted")) {
    return "OpenRouter credits are exhausted. Add credits, then ask again.";
  }
  try {
    const body = JSON.parse(error.message) as { error?: unknown };
    if (typeof body.error === "string") return `The answer failed: ${body.error}`;
  } catch {
    // Not JSON: show the message as is.
  }
  return `The answer failed: ${error.message}`;
}

export function AskPanel({
  threadId: initialThreadId,
  title: initialTitle,
  saved = [],
  initialPrompt,
  figures = {},
}: {
  threadId?: string;
  title?: string;
  saved?: SavedAskMessage[];
  // From /ask?q=…: asked once on mount.
  initialPrompt?: string;
  // Lead figures of the papers cited by the saved answers, keyed by paper id.
  figures?: CitedFigures;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle ?? initialPrompt?.trim().slice(0, 120) ?? "");
  const [input, setInput] = useState("");

  const [chat] = useState(() => {
    const session: { threadId?: string } = { threadId: initialThreadId };
    const created: Chat<AskMessage> = new Chat<AskMessage>({
      messages: initialThreadId ? saved.map((m) => toUiMessage(m, initialThreadId)) : [],
      transport: new DefaultChatTransport<AskMessage>({
        api: "/api/ask",
        prepareSendMessagesRequest: ({ messages }) => {
          const last = messages[messages.length - 1];
          return { body: { threadId: session.threadId, prompt: last ? textOf(last) : "" } };
        },
      }),
      onFinish: async ({ message, isError, isAbort, isDisconnect }) => {
        const meta = message.metadata;
        // A failed answer is not saved, so its thread does not exist.
        if (!meta?.threadId || isError || isAbort || isDisconnect) return;
        // The saved answer is the validated (possibly repaired) version of the streamed draft.
        const response = await fetch(`/api/ask?threadId=${meta.threadId}`);
        if (!response.ok) return;
        const body = (await response.json()) as { messages: SavedAskMessage[] };
        const row = body.messages.find((m) => m.id === meta.messageId);
        if (!row) return;
        const isNew = session.threadId !== meta.threadId;
        session.threadId = meta.threadId;
        const fresh = toUiMessage(row, meta.threadId);
        created.messages = created.messages.map((m) => (m.id === message.id ? { ...fresh, id: m.id } : m));
        if (isNew) router.replace(`/ask?thread=${meta.threadId}`, { scroll: false });
        router.refresh();
      },
    });
    return created;
  });
  const { messages, sendMessage, status, error } = useChat({ chat });

  const busy = status === "submitted" || status === "streaming";

  function ask(prompt: string) {
    const text = prompt.trim();
    if (!text || busy) return;
    if (!title) setTitle(text.slice(0, 120));
    setInput("");
    void sendMessage({ text });
  }

  // The ref keeps Strict Mode's second effect run from asking twice; q is then dropped from the URL
  // so a reload does not ask again.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !initialPrompt?.trim()) return;
    asked.current = true;
    void sendMessage({ text: initialPrompt.trim() });
    router.replace("/ask", { scroll: false });
  }, [initialPrompt, router, sendMessage]);

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="micro">Start from a job</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {JOB_PROMPTS.map((job) => (
              <Button
                key={job.label}
                variant="outline"
                size="sm"
                onClick={() => ask(job.prompt)}
                title={job.prompt}
                className="h-auto min-h-14 flex-col items-start justify-start gap-1 rounded-plate px-3 py-2.5 text-left whitespace-normal"
              >
                <span className="micro text-[10px]">{job.label}</span>
                <span className="text-sm leading-5 font-normal text-foreground">{job.prompt}</span>
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <p key={m.id} className="max-w-[80%] self-end rounded-plate border border-plate-rim bg-plate-hover px-3 py-2 text-sm">
              {textOf(m)}
            </p>
          ) : (
            <Fragment key={m.id}>
              <Answer
                message={m}
                title={title || textOf(messages[i - 1] ?? m)}
                streaming={busy && i === messages.length - 1}
                figures={figures}
              />
            </Fragment>
          ),
        )}
        {status === "submitted" ? <p className="micro">Routing the question…</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{errorMessage(error)}</p> : null}
      </div>

      {/* In flow, not sticky: a sticky composer rests over the thread's figures, and figures must
          never sit under a backdrop-filter. */}
      <form
        className="glass-base flex flex-col gap-2 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a term, a bet, a use case, a field, a date or a client meeting"
          maxLength={2000}
          rows={3}
          className="bg-plate-solid"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
        />
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="micro hidden text-[10px] sm:inline">Enter to ask · Shift+Enter for a new line</span>
          <Button type="submit" className="ml-auto" disabled={busy || !input.trim()}>
            {busy ? "Answering…" : "Ask"}
          </Button>
        </div>
      </form>
    </div>
  );
}
