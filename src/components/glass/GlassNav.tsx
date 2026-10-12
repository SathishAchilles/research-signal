"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const HIDDEN_ON = /^\/(login|a\/)/;

const LINKS = [
  { href: "/", label: "Brief" },
  { href: "/ask", label: "Ask" },
  { href: "/log", label: "Log" },
  { href: "/settings", label: "Settings" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname === "/brief" || pathname.startsWith("/brief/");
  // Search folded into Ask: the full results page (/search) is Ask's "See all results".
  if (href === "/ask") return pathname === "/ask" || pathname.startsWith("/ask/") || pathname === "/search";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const NAV_BOX = "mx-auto mt-3 w-[min(72rem,calc(100%-2rem))] print:hidden";

// Suspense fallback for the nav: reserves the same 12px + 56px box so <main> does not shift when the nav streams in.
export function GlassNavPlaceholder() {
  return <div aria-hidden="true" className={cn(NAV_BOX, "h-14 shrink-0")} />;
}

export function GlassNav() {
  const pathname = usePathname();
  const links = useRef<HTMLUListElement>(null);
  const [overflow, setOverflow] = useState(false);

  // The link row fades at the right edge only when it actually overflows (narrower than ~340px).
  useEffect(() => {
    const list = links.current;
    if (!list) return;
    const measure = () => setOverflow(list.scrollWidth > list.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [pathname]);

  // On narrow screens the link row scrolls sideways; keep the current page's link in view.
  useEffect(() => {
    const list = links.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2;
  }, [pathname]);

  if (HIDDEN_ON.test(pathname)) return null;

  return (
    <header className={cn(NAV_BOX, "sticky top-3 z-30")}>
      <nav aria-label="Primary" className="glass-nav flex h-14 items-center gap-1 px-3">
        <Link
          href="/"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full px-1.5 text-[var(--text)] lg:justify-start"
        >
          <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="9.5" fill="none" stroke="var(--signal)" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="5.5" fill="none" stroke="var(--micro)" strokeWidth="1" strokeDasharray="2 2.4" />
            <circle cx="12" cy="12" r="2.4" fill="var(--signal)" />
          </svg>
          {/* The visible wordmark is the start of the accessible name (WCAG 2.5.3); below lg it stays in the a11y tree. */}
          <span className="micro sr-only lg:not-sr-only">
            Research<span className="text-[var(--signal)]">·</span>Signal
          </span>
          <span className="sr-only">, latest brief</span>
        </Link>

        <ul
          ref={links}
          data-overflow={overflow || undefined}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] data-[overflow]:[mask-image:linear-gradient(to_right,#000_85%,transparent)] md:justify-center"
        >
          {LINKS.map(({ href, label }) => {
            const current = isCurrent(pathname, href);
            return (
              <li key={href} className="shrink-0">
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "relative flex h-11 min-w-11 items-center justify-center rounded-full px-2 text-sm text-[var(--text)] transition-colors hover:bg-white/5 sm:px-3 lg:h-9",
                    current &&
                      "bg-white/[.06] font-medium text-[var(--signal)] after:absolute after:inset-x-3 after:-bottom-px after:h-px after:bg-[var(--signal)]",
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("rs:command-open"))}
          aria-haspopup="dialog"
          aria-keyshortcuts="/ Meta+K Control+K"
          title="Ask (/ or ⌘K)"
          className="glass-chip glass-interactive flex size-11 shrink-0 items-center justify-center gap-2 text-sm text-[var(--text)] md:w-auto md:px-3 lg:h-9 print:hidden"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" focusable="false">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="var(--micro)" strokeWidth="1.5" />
            <path d="M10.5 10.5 14 14" stroke="var(--micro)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {/* Visible "Ask" starts the name (WCAG 2.5.3); the suffix tells it apart from the Ask page link. */}
          <span className="sr-only md:not-sr-only">Ask</span>
          <span className="sr-only">, quick ask dialog</span>
          <kbd aria-hidden="true" className="micro hidden rounded border border-[var(--glass-rim)] px-1.5 leading-5 md:inline">⌘K</kbd>
          <kbd aria-hidden="true" className="micro hidden rounded border border-[var(--glass-rim)] px-1.5 leading-5 md:inline">/</kbd>
        </button>
      </nav>
    </header>
  );
}
