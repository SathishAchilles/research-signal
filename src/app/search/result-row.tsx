import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { SignalType } from "@/lib/pipeline/rank";

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
  figureUrl: string | null;
  signalType: SignalType | null;
};

const THUMB = 40;

// Hosts that next.config.ts images.remotePatterns allows; anything else falls back to the glyph
// so an unexpected figure_url can never make next/image throw.
const FIGURE_HOSTS: [host: string, pathPrefix: string][] = [
  ["arxiv.org", "/html/"],
  ["cdn-uploads.huggingface.co", "/"],
  ["cdn-thumbnails.huggingface.co", "/"],
];

function allowedFigure(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const ok = u.protocol === "https:" && FIGURE_HOSTS.some(([h, p]) => u.hostname === h && u.pathname.startsWith(p));
    return ok ? url : null;
  } catch {
    return null;
  }
}

// Signal-type line glyphs for papers with no figure (same box size, so rows never shift).
const GLYPHS: Record<SignalType, ReactNode> = {
  BENCH: (
    <>
      <path d="M8 40h32" />
      <path d="M12 40V26M20 40V16M28 40V22M36 40V10" strokeWidth={4} />
    </>
  ),
  EVAL: (
    <>
      <path d="M8 8v32h32" />
      <circle cx="16" cy="30" r="2.5" />
      <circle cx="22" cy="22" r="2.5" />
      <circle cx="29" cy="25" r="2.5" />
      <circle cx="34" cy="14" r="2.5" />
    </>
  ),
  REFRAME: (
    <>
      <path d="M8 36L40 12M32 12h8v8" />
      <path d="M8 12l32 24M32 36h8v-8" />
    </>
  ),
  METHOD: (
    <>
      <circle cx="10" cy="24" r="4" />
      <circle cx="38" cy="12" r="4" />
      <circle cx="38" cy="36" r="4" />
      <path d="M14 24h8l12-10M22 24l12 10" />
    </>
  ),
};

// 40px figure thumbnail column. The image sits on a solid plate with a 1px rim, never under a
// backdrop-filter; the vignette is an overlay above the image so the figure itself is untouched.
export function RowThumb({
  title,
  figureUrl,
  signalType,
}: {
  title: string;
  figureUrl: string | null;
  signalType: SignalType | null;
}) {
  const src = allowedFigure(figureUrl);
  return (
    <span
      className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-plate-rim bg-plate-solid text-signal-2"
      style={{ width: THUMB, height: THUMB }}
    >
      {src ? (
        <>
          <Image
            src={src}
            alt={`Figure from ${title}`}
            width={THUMB}
            height={THUMB}
            sizes={`${THUMB}px`}
            loading="lazy"
            className="size-full bg-white object-cover"
          />
          <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_6px_rgb(0_0_0/.35)]" />
        </>
      ) : (
        <svg
          viewBox="0 0 48 48"
          width="60%"
          height="60%"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-label={signalType ? `${signalType} paper, no figure` : "No figure"}
        >
          {signalType ? GLYPHS[signalType] : <rect x="10" y="10" width="28" height="28" strokeDasharray="4 4" />}
        </svg>
      )}
    </span>
  );
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

export function ResultRow({ hit }: { hit: ResultView }) {
  const date = hit.publishedAt ? new Date(hit.publishedAt).toISOString().slice(0, 10) : null;
  const signals = [
    hit.hfUpvotes !== null ? `HF ${compact(hit.hfUpvotes)}` : null,
    hit.githubStars !== null ? `${compact(hit.githubStars)} stars` : null,
  ].filter(Boolean);

  return (
    <li className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-plate-hover">
      <RowThumb title={hit.title} figureUrl={hit.figureUrl} signalType={hit.signalType} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
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
          {date && <span className="num">· {date}</span>}
          {signals.length > 0 && <span className="num">· {signals.join(" · ")}</span>}
          {hit.myAction && (
            <span>
              · you: {hit.myAction}
              {hit.clientTag ? ` (${hit.clientTag})` : ""}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
