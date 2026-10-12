import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

// Exact public paths (or their sub-paths), plus public prefixes; "/loginx" or "/api/healthz" stay protected.
const PUBLIC_PATH = /^\/((login|api\/health|favicon\.ico)(\/|$)|a\/|api\/stage\/|_next\/)/;

export async function proxy(request: NextRequest) {
  if (PUBLIC_PATH.test(request.nextUrl.pathname)) return NextResponse.next();
  if (await readSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}
