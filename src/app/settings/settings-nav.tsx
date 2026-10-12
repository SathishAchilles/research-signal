"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/domains", label: "Domains" },
  { href: "/settings/sources", label: "Sources" },
  { href: "/settings/delivery", label: "Delivery" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/usage", label: "Usage" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings"
      className="plate flex w-fit max-w-full gap-1 overflow-x-auto rounded-full p-1"
    >
      {TABS.map(({ href, label }) => {
        const active =
          pathname === href || pathname.startsWith(`${href}/`) || (pathname === "/settings" && href === TABS[0].href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "glass-interactive shrink-0 rounded-full px-3 py-1 text-sm font-medium text-muted-foreground hover:text-foreground",
              active && "bg-signal/15 text-foreground ring-1 ring-signal/50",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
