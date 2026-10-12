// papers.figure_source values (lib/sources/hf.ts FIGURE_SOURCES). "hf_thumb" is Hugging Face's
// rendered first page of the PDF: a picture of the title page, not a figure from the paper.
export type FigureSource = "hf_media" | "arxiv_html" | "hf_thumb";

/**
 * True when the figure is an actual figure from the paper. The rendered title page ("hf_thumb")
 * is excluded from the figure stage, the domain banners and hero cards, which show the
 * signal-type glyph instead. A null source (legacy rows) counts as real.
 */
export function isRealFigure(source: string | null | undefined): boolean {
  return source !== "hf_thumb";
}

/** The label for a rendered title page where it is still shown, e.g. the paper page gallery. */
export const FIRST_PAGE_LABEL = "First page";
