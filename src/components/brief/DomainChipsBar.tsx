import type { BriefSelection } from "@/lib/brief/types";

const CHIP = "glass-chip glass-interactive shrink-0 px-3 py-1 text-xs whitespace-nowrap";

export function DomainChipsBar({ selection }: { selection: BriefSelection }) {
  return (
    <nav
      aria-label="Domains"
      className="glass-base sticky top-[76px] z-20 -mx-4 flex items-center gap-2 overflow-x-auto px-4 py-2 print:static"
    >
      {selection.domains.map((d) => {
        const count = (d.hero ? 1 : 0) + d.standard.length + d.compact.length;
        return (
          <a key={d.slug} href={`#${d.slug}`} className={CHIP}>
            {d.name} <span className="num text-muted-foreground">{count}</span>
          </a>
        );
      })}
      {selection.rising.length > 0 ? (
        <a href="#rising" className={CHIP}>
          Rising <span className="num text-muted-foreground">{selection.rising.length}</span>
        </a>
      ) : null}
      <form action="/search" className="ml-auto shrink-0">
        <input
          name="q"
          type="search"
          data-search-input
          placeholder="Search papers ( / )"
          aria-label="Search papers"
          className="h-8 w-48 rounded-tile border border-input bg-plate-solid px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus"
        />
      </form>
    </nav>
  );
}
