import type { NextRequest } from "next/server";
import { listLog, parseLogFilters, toCsv } from "@/lib/brief/log";

export async function GET(request: NextRequest) {
  const rows = await listLog(parseLogFilters(request.nextUrl.searchParams));
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="notable-log-${stamp}.csv"`,
      "cache-control": "no-store",
      "x-row-count": String(rows.length),
    },
  });
}
