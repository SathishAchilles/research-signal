"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
type Hit = { id: number; entityType: string; paperId: string | null; title: string; publishedAt: string | null };

const HIDDEN_ON = /^\/(login|a\/)/;
const DEBOUNCE_MS = 200;
// Instant matches shown under the Ask row. A paper can match as several docs (paper, summary, note),
// so fetch a wider page and keep the first PAPER_LIMIT distinct papers.
const PAPER_LIMIT = 8;
const FETCH_LIMIT = 24;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function CommandBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hidden = HIDDEN_ON.test(pathname);

  useEffect(() => {
    if (hidden) return;
    const onKey = (event: KeyboardEvent) => {
      const commandK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const slash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditable(event.target);
      // A page that owns "/" (the brief focuses its own search box) prevents the default first.
      if (!commandK && (!slash || event.defaultPrevented)) return;
      event.preventDefault();
      setOpen((current) => (commandK ? !current : true));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden]);

  // The nav's Ask pill (GlassNav) opens the dialog through this event.
  useEffect(() => {
    if (hidden) return;
    const onOpen = () => setOpen(true);
    window.addEventListener("rs:command-open", onOpen);
    return () => window.removeEventListener("rs:command-open", onOpen);
  }, [hidden]);

  const text = query.trim();

  useEffect(() => {
    if (!open || text === "") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: text, limit: String(FETCH_LIMIT) });
        const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
        const body = (await response.json().catch(() => ({}))) as { hits?: Hit[]; error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok) {
          console.error("command bar matches failed", response.status);
          setError(body.error === "llm_credits_exhausted" ? "LLM credits exhausted; paper matches need them." : "Paper matches failed to load.");
          setHits([]);
          return;
        }
        setError(null);
        setHits(body.hits ?? []);
      } catch (failure) {
        // A rejected fetch (network down, CORS, DNS) lands here; an abort is not a failure.
        if (controller.signal.aborted) return;
        console.error("command bar matches failed", failure instanceof Error ? failure.message : String(failure));
        setError("Paper matches failed to load.");
        setHits([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
      // The query changed, emptied or the bar closed: the old request's error and spinner are stale.
      setError(null);
      setLoading(false);
    };
  }, [open, text]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      setHits([]);
      router.push(href);
    },
    [router],
  );

  if (hidden) return null;

  const askHref = `/ask?${new URLSearchParams({ q: text })}`;
  const searchHref = `/search?${new URLSearchParams({ q: text })}`;
  const papers =
    text === ""
      ? []
      : hits
          .filter((hit): hit is Hit & { paperId: string } => hit.paperId !== null)
          .filter((hit, i, all) => all.findIndex((h) => h.paperId === hit.paperId) === i)
          .slice(0, PAPER_LIMIT);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Ask"
      description="Ask a question about the research, or open a matching paper."
      className="glass-elevated sm:max-w-xl print:hidden"
    >
      <Command shouldFilter={false}>
        <CommandInput value={query} onValueChange={setQuery} placeholder="Ask a question, or find a paper…" />
        <CommandList>
          {text === "" ? (
            <CommandEmpty>Type a question or a paper title.</CommandEmpty>
          ) : (
            <>
              {/* First row, so cmdk selects it by default: Enter asks. */}
              <CommandGroup heading="Ask">
                <CommandItem value="__ask" onSelect={() => go(askHref)} className="plate my-0.5 data-[selected=true]:bg-plate-hover">
                  <span className="truncate">Ask: “{text}”</span>
                  <CommandShortcut>↵</CommandShortcut>
                </CommandItem>
              </CommandGroup>
              {error && (
                <p role="alert" className="px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}
              {papers.length > 0 && (
                <CommandGroup heading="Papers">
                  {papers.map((hit) => (
                    <CommandItem
                      key={hit.paperId}
                      value={`paper-${hit.paperId}`}
                      className="plate my-0.5 data-[selected=true]:bg-plate-hover"
                      onSelect={() => go(`/paper/${hit.paperId}`)}
                    >
                      <span className="truncate">{hit.title}</span>
                      <CommandShortcut className="tracking-normal">{hit.entityType}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandGroup heading="More">
                <CommandItem value="__all" onSelect={() => go(searchHref)} className="plate my-0.5 data-[selected=true]:bg-plate-hover">
                  See all results
                  <CommandShortcut>{loading ? "…" : "→"}</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
