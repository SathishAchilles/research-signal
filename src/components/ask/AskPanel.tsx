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
  TOKEN,
  fillEvidenceTokens,
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

// Inline Markdown: **bold**, `code` and [pN] citations as links to the paper page.
function inline(text: string, cites: Map<string, AskCitation>): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[p\d+\])/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const token = match[0];
    if (token.startsWith("**")) out.push(<strong key={index}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={index} className="rounded bg-plate-hover px-1 font-mono text-[0.85em]">{token.slice(1, -1)}</code>);
    else {
      const ref = token.slice(1, -1);
      const cite = cites.get(ref);
      out.push(
        cite ? (
          <Link key={index} href={`/paper/${cite.paperId}`} title={cite.title} className="text-primary underline underline-offset-2">
            [{ref}]
          </Link>
        ) : (
          <span key={index} className="text-muted-foreground">[{ref}]</span>
        ),
      );
    }
    last = index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text, cites }: { text: string; cites: Map<string, AskCitation> }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push(
        <h3 key={i} className="mt-3 font-heading font-semibold">
          {inline(heading[2], cites)}
        </h3>,
      );
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      const [head, ...body] = rows;
      blocks.push(
        <div key={i} className="overflow-x-auto">
          <table className="my-2 w-full text-left text-sm tabular-nums">
            <thead>
              <tr>{head?.map((c, j) => <th key={j} className="border-b border-border py-1 pr-3 font-medium">{inline(c, cites)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, k) => (
                <tr key={k}>{r.map((c, j) => <td key={j} className="border-b border-border py-1 pr-3 align-top">{inline(c, cites)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (item) {
      blocks.push(
        <p key={i} className="pl-4 -indent-3">
          • {inline(item[1], cites)}
        </p>,
      );
      continue;
    }
    const note = line.match(/^_(.+)_$/);
    if (note) {
      blocks.push(
        <p key={i} className="italic text-muted-foreground">
          {note[1]}
        </p>,
      );
      continue;
    }
    blocks.push(<p key={i}>{inline(line, cites)}</p>);
  }
  return <div className="flex flex-col gap-1.5 text-sm leading-6">{blocks}</div>;
}

function asMarkdown(message: AskMessage, title: string, origin: string): string {
  const cites = [...citationMap(message).values()];
  const sources = cites.map((c) => `- [${c.ref}] ${c.title} (${c.rung ?? "LAB"}): ${origin}/paper/${c.paperId}`);
  const meta = message.metadata;
  return [
    `# ${title}`,
    "",
    meta?.confidence ? `Confidence: ${meta.confidence}` : "",
    meta?.coverage?.line ?? "",
    "",
    displayText(message),
    "",
    sources.length ? "## Sources" : "",
    ...sources,
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

function AnswerActions({ message, title }: { message: AskMessage; title: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const cites = [...citationMap(message).values()];

  async function copy() {
    await navigator.clipboard.writeText(asMarkdown(message, title, window.location.origin));
    setStatus("Copied as a client note.");
  }

  function exportMd() {
    const blob = new Blob([asMarkdown(message, title, window.location.origin)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "answer"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveToLog() {
    setStatus("Saving…");
    const results = await Promise.allSettled(
      cites.map((c) =>
        fetch("/api/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paperId: c.paperId, action: "CLIENT", note: `From Ask: ${title}`, origin: "ask" }),
        }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
        }),
      ),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    setStatus(failed ? `Saved ${cites.length - failed} of ${cites.length} papers to the log.` : `Saved ${cites.length} papers to the log.`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <Button size="sm" variant="outline" onClick={copy}>Copy as client note</Button>
      <Button size="sm" variant="outline" onClick={exportMd}>Export .md</Button>
      <Button size="sm" variant="outline" onClick={saveToLog} disabled={cites.length === 0}>Save to log</Button>
      {status ? <span role="status" className="text-xs text-muted-foreground">{status}</span> : null}
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
                    {c.title}
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
  const text = displayText(message);
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
      </div>
      {meta?.confidence === "Low" ? (
        <p className="rounded-tile bg-destructive/10 px-3 py-2 text-sm text-destructive">Thin evidence: treat this answer as a lead, not a conclusion.</p>
      ) : null}
      {coverage?.warning ? <p className="rounded-tile bg-plate-hover px-3 py-2 text-sm">{coverage.warning}</p> : null}
      {text ? <Markdown text={text} cites={cites} /> : streaming ? <p className="text-sm text-muted-foreground">Searching…</p> : null}
      {coverage?.line ? <p className="font-mono text-[11px] leading-4 tracking-wide text-micro">{coverage.line}</p> : null}
      {!streaming || cites.size ? <CitedPapers cites={[...cites.values()]} figures={figures} /> : null}
      {!streaming && text ? <AnswerActions message={message} title={title} /> : null}
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
