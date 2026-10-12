"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const HIDDEN_ON = /^\/(login|a\/)/;
const STORAGE_KEY = "rs-glass";

const LINKS = [
  { href: "/", label: "Brief" },
  { href: "/search", label: "Search" },
  { href: "/ask", label: "Ask" },
  { href: "/log", label: "Log" },
  { href: "/settings", label: "Settings" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname === "/brief" || pathname.startsWith("/brief/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

// The "Solid panels" state lives on <html data-glass>, which the boot script sets before paint.
// Reading it through useSyncExternalStore keeps SSR (always false) and the client in step without a mismatch.
function subscribeGlass(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-glass"] });
  return () => observer.disconnect();
}
const readSolid = () => document.documentElement.dataset.glass === "off";
const readSolidOnServer = () => false;

export function GlassNav() {
  const pathname = usePathname();
  const solid = useSyncExternalStore(subscribeGlass, readSolid, readSolidOnServer);
  const links = useRef<HTMLUListElement>(null);

  // On narrow screens the link row scrolls sideways; keep the current page's link in view.
  useEffect(() => {
    const list = links.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2;
  }, [pathname]);

  const toggleSolid = useCallback(() => {
    const next = !readSolid();
    const root = document.documentElement;
    if (next) root.dataset.glass = "off";
    else delete root.dataset.glass;
    try {
      if (next) localStorage.setItem(STORAGE_KEY, "off");
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can throw (private mode, blocked site data); the toggle still applies for this page view.
    }
  }, []);

  if (HIDDEN_ON.test(pathname)) return null;

  return (
    <header className="sticky top-3 z-30 mx-auto mt-3 w-[min(72rem,calc(100%-2rem))] print:hidden">
      <nav aria-label="Primary" className="glass-nav flex h-14 items-center gap-1 px-3">
        <Link
          href="/"
          className="hidden shrink-0 items-center gap-2 rounded-full px-1.5 py-1 text-[var(--text)] sm:flex"
          aria-label="Research Signal, latest brief"
        >
          <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="9.5" fill="none" stroke="var(--signal)" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="5.5" fill="none" stroke="var(--micro)" strokeWidth="1" strokeDasharray="2 2.4" />
            <circle cx="12" cy="12" r="2.4" fill="var(--signal)" />
          </svg>
          <span className="micro hidden lg:inline">
            Research<span className="text-[var(--signal)]">·</span>Signal
          </span>
        </Link>

        <ul
          ref={links}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [mask-image:linear-gradient(to_right,#000_85%,transparent)] [scrollbar-width:none] md:justify-center md:[mask-image:none]"
        >
          {LINKS.map(({ href, label }) => {
            const current = isCurrent(pathname, href);
            return (
              <li key={href} className="shrink-0">
                <Link
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "relative block rounded-full px-2 py-1.5 text-sm text-[var(--text)] transition-colors hover:bg-white/5 sm:px-3",
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
          className="glass-chip glass-interactive flex h-9 shrink-0 items-center gap-2 px-3 text-sm text-[var(--text)] print:hidden"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" focusable="false">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="var(--micro)" strokeWidth="1.5" />
            <path d="M10.5 10.5 14 14" stroke="var(--micro)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="sr-only md:not-sr-only">Search or ask</span>
          <kbd className="micro hidden rounded border border-[var(--glass-rim)] px-1.5 leading-5 md:inline">/</kbd>
        </button>

        <button
          type="button"
          aria-pressed={solid}
          title="Solid panels"
          onClick={toggleSolid}
          className={cn(
            "glass-chip glass-interactive flex h-9 shrink-0 items-center gap-2 px-3 text-sm text-[var(--text)]",
            solid && "border-[var(--signal)] text-[var(--signal)]",
          )}
        >
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" focusable="false">
            <rect
              x="2"
              y="2"
              width="12"
              height="12"
              rx="3"
              fill={solid ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          <span className="sr-only xl:not-sr-only">Solid panels</span>
        </button>
      </nav>
    </header>
  );
}
