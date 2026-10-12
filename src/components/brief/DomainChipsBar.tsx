import type { BriefSelection } from "@/lib/brief/types";

export function DomainChipsBar({ selection }: { selection: BriefSelection }) {
  return (
    <nav
      aria-label="Domains"
      className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur"
    >
      {selection.domains.map((d) => {
        const count = (d.hero ? 1 : 0) + d.standard.length + d.compact.length;
        return (
          <a key={d.slug} href={`#${d.slug}`} className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted">
            {d.name} <span className="text-muted-foreground">{count}</span>
          </a>
        );
      })}
      {selection.rising.length > 0 ? (
        <a href="#rising" className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted">
          Rising <span className="text-muted-foreground">{selection.rising.length}</span>
        </a>
      ) : null}
      <form action="/search" className="ml-auto">
        <input
          name="q"
          type="search"
          data-search-input
          placeholder="Search papers ( / )"
          aria-label="Search papers"
          className="h-8 w-48 rounded-md border bg-background px-2 text-sm"
        />
      </form>
    </nav>
  );
}
