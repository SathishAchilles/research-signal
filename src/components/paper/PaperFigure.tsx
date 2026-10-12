import Image from "next/image";
import Link from "next/link";
import { FIRST_PAGE_LABEL } from "@/lib/brief/figures";
import type { SignalType } from "@/lib/pipeline/rank";
import { cn } from "@/lib/utils";
import { SignalGlyph, signalGlyphLabel } from "./SignalGlyph";

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
  // Additive options (every existing caller keeps working without them).
  /** Paper title; when given, alt reads "Figure from <title>". */
  title?: string;
  /** The first hero frame only: preloaded and eager. Everything else is lazy. */
  priority?: boolean;
  /** Overrides the default `sizes` (`<width>px`) for fluid layouts. */
  sizes?: string;
  /** Caption plate with caption and attribution. Off for thumbnails. Default true. */
  showCaption?: boolean;
  /** Wrap the frame in a link to /paper/<id>. Turn off inside rows that are already links. Default true. */
  linked?: boolean;
  /** papers.figure_source. "hf_thumb" is the rendered title page: it is labelled "First page", not a figure. */
  figureSource?: string | null;
};

// The hosts next.config.ts images.remotePatterns allows. next/image throws at render for any other
// host, so an unservable URL falls back to the glyph instead of breaking the page.
export function isServableFigure(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (u.hostname === "arxiv.org") return u.pathname.startsWith("/html/");
    return u.hostname === "cdn-uploads.huggingface.co" || u.hostname === "cdn-thumbnails.huggingface.co";
  } catch {
    return false;
  }
}

export function figureAttribution(authors: readonly string[], arxivId: string | null): string {
  const first = authors[0]?.trim();
  const who = first ? `${first}${authors.length > 1 ? " et al." : ""}` : "Authors";
  return `Figure: ${who}${arxivId ? `, arXiv ${arxivId}` : ""}`;
}

// Specimen-frame corner brackets (decorative), drawn in the frame's padding, never over the figure.
function Corners() {
  const base = "pointer-events-none absolute size-2.5 border-signal/70";
  return (
    <>
      <span aria-hidden className={`${base} top-1 left-1 border-t border-l`} />
      <span aria-hidden className={`${base} top-1 right-1 border-t border-r`} />
      <span aria-hidden className={`${base} bottom-1 left-1 border-b border-l`} />
      <span aria-hidden className={`${base} right-1 bottom-1 border-r border-b`} />
    </>
  );
}

// The paper's lead figure in a fixed box with its caption and attribution, linked to the paper.
// - Images go through next/image (Vercel resizes and caches them; they are never re-hosted).
// - The frame is a solid plate with a 1px rim. It must never sit under a backdrop-filter element.
// - The figure sits on a light mat (arXiv figures are often transparent with dark strokes) and is
//   never blurred or tinted; only a subtle inset vignette overlays it.
// - Without a servable figure, the same box shows the signal-type glyph, so nothing shifts.
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
  title,
  priority = false,
  sizes,
  showCaption = true,
  linked = true,
  figureSource,
}: PaperFigureProps) {
  const attribution = figureAttribution(authors, arxivId);
  const src = isServableFigure(figureUrl) ? figureUrl : null;
  const firstPage = figureSource === "hf_thumb";
  const text = firstPage ? FIRST_PAGE_LABEL : caption?.trim();
  const framed = height >= 120; // thumbnails skip the padding and corner marks
  const frameClass = cn(
    "relative flex items-center justify-center overflow-hidden border border-plate-rim bg-plate-solid text-signal/75",
    framed ? "rounded-tile p-2" : "rounded-[6px]",
    linked && "transition-colors duration-150 hover:border-signal/60",
  );

  const inner = (
    <>
      {src ? (
        <span className={cn("relative block size-full overflow-hidden bg-[#F3F7F7]", framed ? "rounded-[6px]" : "rounded-[5px]")}>
          <Image
            src={src}
            alt={firstPage ? `${FIRST_PAGE_LABEL} of ${title ?? "the paper"}` : title ? `Figure from ${title}` : text || attribution}
            fill
            sizes={sizes ?? `${width}px`}
            preload={priority}
            loading={priority ? undefined : "lazy"}
            fetchPriority={priority ? "high" : undefined}
            className={cn("object-contain", framed && "p-1")}
          />
          <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_24px_rgb(4_20_24/.2)]" />
        </span>
      ) : (
        <span
          className="flex size-full items-center justify-center rounded-[6px] bg-[linear-gradient(rgb(127_224_230/.05)_1px,transparent_1px),linear-gradient(90deg,rgb(127_224_230/.05)_1px,transparent_1px)] bg-size-[12px_12px]"
        >
          <SignalGlyph signalType={signalType} size={framed ? "38%" : "70%"} label={signalGlyphLabel(signalType)} />
        </span>
      )}
      {framed ? <Corners /> : null}
    </>
  );

  return (
    <figure data-figure={src ? (firstPage ? "first-page" : "image") : "glyph"} className={cn("text-foreground", className)} style={{ width, maxWidth: "100%" }}>
      {linked ? (
        <Link href={`/paper/${paperId}`} className={frameClass} style={{ width: "100%", height }}>
          {inner}
        </Link>
      ) : (
        <div className={frameClass} style={{ width: "100%", height }}>
          {inner}
        </div>
      )}
      {showCaption ? (
        <figcaption className="mt-1.5 rounded-tile border border-plate-rim bg-plate px-2.5 py-1.5 text-[11px] leading-4 [text-shadow:none]">
          {src ? (
            <>
              {text ? <span className="line-clamp-2 text-foreground/90">{text}</span> : null}
              <span className="mt-0.5 block font-mono text-[10.5px] tracking-[.02em] text-muted-foreground">
                {firstPage ? attribution.replace(/^Figure: /, "") : attribution}
              </span>
            </>
          ) : (
            <span className="block font-mono text-[10.5px] tracking-[.02em] text-muted-foreground">
              No figure{signalType ? ` · ${signalType}` : ""}
            </span>
          )}
        </figcaption>
      ) : null}
    </figure>
  );
}
