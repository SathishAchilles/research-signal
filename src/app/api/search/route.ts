import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LlmCreditsExhausted } from "@/lib/llm/call";
import { MAX_SEARCH_LIMIT, SEARCH_SORTS, search, searchFiltersSchema } from "@/lib/search/query";

const paramsSchema = z.object({
  q: z.string().max(500).default(""),
  filters: z
    .string()
    .default("{}")
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "filters must be JSON" });
        return z.NEVER;
      }
    })
    .pipe(searchFiltersSchema),
  sort: z.enum(SEARCH_SORTS).default("relevance"),
  limit: z.coerce.number().int().min(1).max(MAX_SEARCH_LIMIT).default(20),
});

export async function GET(request: NextRequest) {
  const raw = Object.fromEntries(
    ["q", "filters", "sort", "limit"].flatMap((key) => {
      const value = request.nextUrl.searchParams.get(key);
      return value === null || value === "" ? [] : [[key, value]];
    }),
  );
  const parsed = paramsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", message: z.prettifyError(parsed.error) }, { status: 400 });
  }
  try {
    const hits = await search(parsed.data);
    return NextResponse.json({ hits });
  } catch (error) {
    // Only the query embedding calls the LLM gateway; without credits it fails with HTTP 402.
    if (error instanceof LlmCreditsExhausted) {
      return NextResponse.json({ error: "llm_credits_exhausted" }, { status: 402 });
    }
    console.error("search failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "search_failed" }, { status: 500 });
  }
}
