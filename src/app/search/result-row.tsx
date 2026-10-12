import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export type ResultView = {
  id: number;
  entityType: string;
  paperId: string | null;
  title: string;
  publishedAt: string | null;
  attention: number | null;
  rung: string | null;
  verdict: string | null;
  domain: string | null;
  myAction: string | null;
  clientTag: string | null;
  hfUpvotes: number | null;
  githubStars: number | null;
  urlAbs: string | null;
};

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

export function ResultRow({ hit }: { hit: ResultView }) {
  const date = hit.publishedAt ? new Date(hit.publishedAt).toISOString().slice(0, 10) : null;
  const signals = [
    hit.hfUpvotes !== null ? `HF ${compact(hit.hfUpvotes)}` : null,
    hit.githubStars !== null ? `${compact(hit.githubStars)} stars` : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-1 rounded-md border bg-card px-4 py-2.5">
      <div className="flex items-start gap-2">
        {hit.entityType !== "paper" && (
          <Badge variant="outline" className="shrink-0">
            {hit.entityType}
          </Badge>
        )}
        {hit.paperId ? (
          <Link href={`/paper/${hit.paperId}`} className="font-medium leading-snug hover:underline">
            {hit.title}
          </Link>
        ) : (
          <span className="font-medium leading-snug">{hit.title}</span>
        )}
        {hit.urlAbs && (
          <a
            href={hit.urlAbs}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            abs ↗
          </a>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {hit.verdict && <Badge variant={hit.verdict === "CLIENT" ? "default" : "secondary"}>{hit.verdict}</Badge>}
        {hit.rung && <Badge variant="outline">{hit.rung}</Badge>}
        {hit.domain && <span>{hit.domain}</span>}
        {date && <span>· {date}</span>}
        {signals.length > 0 && <span>· {signals.join(" · ")}</span>}
        {hit.myAction && (
          <span>
            · you: {hit.myAction}
            {hit.clientTag ? ` (${hit.clientTag})` : ""}
          </span>
        )}
      </div>
    </li>
  );
}
