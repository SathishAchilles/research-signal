import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

// Exact public paths (or their sub-paths), plus public prefixes; "/loginx" or "/api/healthz" stay protected.
const PUBLIC_PATH = /^\/((login|api\/health|favicon\.ico)(\/|$)|a\/|api\/stage\/|_next\/)/;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATH.test(pathname)) return NextResponse.next();
  // The actions route checks a signed email token or the session itself, so email links work signed out.
  if (request.method === "POST" && pathname === "/api/actions") return NextResponse.next();
  if (await readSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}
