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
import { cn } from "@/lib/utils";

type Mode = "search" | "ask";
type Hit = { id: number; entityType: string; paperId: string | null; title: string; publishedAt: string | null };

const HIDDEN_ON = /^\/(login|a\/)/;
const DEBOUNCE_MS = 200;
const HIT_LIMIT = 8;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function CommandBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("search");
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

  const text = query.trim();

  useEffect(() => {
    if (!open || mode !== "search" || text === "") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: text, limit: String(HIT_LIMIT) });
        const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
        const body = (await response.json().catch(() => ({}))) as { hits?: Hit[]; error?: string };
        if (!response.ok) {
          setError(body.error === "llm_credits_exhausted" ? "LLM credits exhausted; search needs them." : "Search failed.");
          throw new Error(`search failed with HTTP ${response.status}`);
        }
        setError(null);
        setHits(body.hits ?? []);
      } catch (failure) {
        if (!controller.signal.aborted) {
          console.error("command bar search failed", failure instanceof Error ? failure.message : String(failure));
          setHits([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, mode, text]);

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

  const searchHref = `/search?${new URLSearchParams({ q: text })}`;
  const askHref = `/ask?${new URLSearchParams({ q: text })}`;
  // A paper can match as several docs (paper, summary, note); show it once.
  const visibleHits =
    mode === "search" && text !== ""
      ? hits.filter((hit, i) => !hit.paperId || hits.findIndex((h) => h.paperId === hit.paperId) === i)
      : [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-lg border bg-background/90 px-3 py-1.5 text-sm text-muted-foreground shadow-sm backdrop-blur hover:text-foreground print:hidden"
      >
        Search or ask
        <kbd className="rounded border bg-muted px-1.5 font-mono text-xs">/</kbd>
      </button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search or ask"
        description="Search the index, or switch to Ask with Tab."
        className="sm:max-w-xl"
      >
        <Command
          shouldFilter={false}
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            event.preventDefault();
            setMode((current) => (current === "search" ? "ask" : "search"));
          }}
        >
          <div className="flex items-center gap-1 px-2 pt-2 text-xs" role="tablist" aria-label="Mode">
            {(["search", "ask"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-md px-2 py-0.5 capitalize text-muted-foreground",
                  mode === m && "bg-muted font-medium text-foreground",
                )}
              >
                {m}
              </button>
            ))}
            <span className="ml-auto text-muted-foreground">Tab switches mode</span>
          </div>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={mode === "search" ? "Search papers, notes, briefs…" : "Ask a question about the research…"}
          />
          <CommandList>
            {text === "" ? (
              <CommandEmpty>{mode === "search" ? "Type to search." : "Type a question."}</CommandEmpty>
            ) : mode === "search" ? (
              <>
                <CommandGroup heading="Search">
                  <CommandItem value="__search" onSelect={() => go(searchHref)}>
                    Search for “{text}”
                    <CommandShortcut>{loading ? "…" : "↵"}</CommandShortcut>
                  </CommandItem>
                </CommandGroup>
                {error && (
                  <p role="alert" className="px-3 py-2 text-xs text-destructive">
                    {error}
                  </p>
                )}
                {visibleHits.length > 0 && (
                  <CommandGroup heading="Top hits">
                    {visibleHits.map((hit) => (
                      <CommandItem
                        key={hit.id}
                        value={`hit-${hit.id}`}
                        onSelect={() => go(hit.paperId ? `/paper/${hit.paperId}` : searchHref)}
                      >
                        <span className="truncate">{hit.title}</span>
                        <CommandShortcut className="tracking-normal">{hit.entityType}</CommandShortcut>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            ) : (
              <CommandGroup heading="Ask">
                <CommandItem value="__ask" onSelect={() => go(askHref)}>
                  Ask: “{text}”
                  <CommandShortcut>↵</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
