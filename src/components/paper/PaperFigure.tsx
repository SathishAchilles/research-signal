import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import type { SignalType } from "@/lib/pipeline/rank";

export type PaperFigureProps = {
  paperId: string;
  arxivId: string | null;
  figureUrl: string | null;
  caption?: string | null;
  authors: readonly string[];
  signalType: SignalType | null;
  width?: number;
  height?: number;
  className?: string;
};

// Simple line glyphs drawn in currentColor, one per signal type, for papers with no figure.
const GLYPHS: Record<SignalType, ReactNode> = {
  BENCH: (
    <>
      <path d="M8 40h32" />
      <path d="M12 40V26M20 40V16M28 40V22M36 40V10" strokeWidth={4} />
    </>
  ),
  EVAL: (
    <>
      <path d="M24 8v32M12 40h24M10 16h28" />
      <path d="M10 16l-5 12h10zM38 16l-5 12h10z" />
    </>
  ),
  REFRAME: (
    <>
      <rect x="8" y="8" width="24" height="24" />
      <rect x="16" y="16" width="24" height="24" strokeDasharray="3 3" />
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

function Glyph({ signalType }: { signalType: SignalType | null }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width="40%"
      height="40%"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={signalType ? `${signalType} paper, no figure` : "No figure"}
    >
      {signalType ? GLYPHS[signalType] : <rect x="8" y="8" width="32" height="32" strokeDasharray="4 4" />}
    </svg>
  );
}

export function figureAttribution(authors: readonly string[], arxivId: string | null): string {
  const first = authors[0]?.trim();
  const who = first ? `${first}${authors.length > 1 ? " et al." : ""}` : "Authors";
  return `Figure: ${who}${arxivId ? `, arXiv ${arxivId}` : ""}`;
}

// The paper's lead figure in a fixed box, linked to the paper, with its caption and attribution.
// Images go through next/image (Vercel resizes and caches them; they are never re-hosted). Without
// a figure, the box shows the signal-type glyph instead.
export function PaperFigure({
  paperId,
  arxivId,
  figureUrl,
  caption,
  authors,
  signalType,
  width = 320,
  height = 200,
  className,
}: PaperFigureProps) {
  const attribution = figureAttribution(authors, arxivId);
  return (
    <figure className={className} style={{ width, maxWidth: "100%" }}>
      <Link
        href={`/paper/${paperId}`}
        className="relative flex items-center justify-center overflow-hidden border border-current/15 bg-white text-current/40"
        style={{ width: "100%", height }}
      >
        {figureUrl ? (
          <Image
            src={figureUrl}
            alt={caption?.trim() || attribution}
            fill
            sizes={`${width}px`}
            className="object-contain"
          />
        ) : (
          <Glyph signalType={signalType} />
        )}
      </Link>
      {figureUrl && (
        <figcaption className="mt-1 text-[11px] leading-4 text-current/70">
          {caption?.trim() && <span className="line-clamp-2">{caption.trim()}</span>}
          <span className="block">{attribution}</span>
        </figcaption>
      )}
    </figure>
  );
}
