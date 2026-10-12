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
    <nav aria-label="Settings" className="flex w-fit gap-1 rounded-lg bg-muted p-1">
      {TABS.map(({ href, label }) => {
        const active =
          pathname === href || pathname.startsWith(`${href}/`) || (pathname === "/settings" && href === TABS[0].href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              active && "bg-background text-foreground shadow-sm",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
