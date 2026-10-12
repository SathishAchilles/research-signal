import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifyAction } from "@/lib/brief/actions-link";
import { ACTION_KINDS, recordAction } from "@/lib/brief/log";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

const bodySchema = z.union([
  z.object({ token: z.string().min(10).max(1000) }),
  z.object({
    paperId: z.uuid(),
    action: z.enum(ACTION_KINDS),
    origin: z.enum(["web", "ask"]).default("web"),
    note: z.string().max(4000).optional(),
    clientTag: z.string().max(80).optional(),
  }),
]);

async function readBody(request: NextRequest): Promise<{ data: unknown; form: boolean }> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    return { data: Object.fromEntries((await request.formData()).entries()), form: true };
  }
  return { data: await request.json().catch(() => null), form: false };
}

// Records an action from a signed email link (no session needed) or from the signed-in web app.
// GET is not handled, so link scanners that only fetch pages never record anything.
export async function POST(request: NextRequest) {
  const { data, form } = await readBody(request);
  const parsed = bodySchema.safeParse(data);
  if (!parsed.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  if ("token" in parsed.data) {
    const claim = verifyAction(parsed.data.token);
    if (!claim) return NextResponse.json({ error: "invalid or expired link" }, { status: 403 });
    const result = await recordAction({ paperId: claim.p, action: claim.a, origin: "email" });
    if (form) {
      return NextResponse.redirect(new URL(`/a/${encodeURIComponent(parsed.data.token)}?recorded=1`, request.url), 303);
    }
    return NextResponse.json({ ok: true, action: claim.a, changed: result.changed });
  }

  if (!(await readSession(request.cookies.get(SESSION_COOKIE)?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { paperId, action, origin, note, clientTag } = parsed.data;
  try {
    const result = await recordAction({ paperId, action, origin, note, clientTag });
    return NextResponse.json({ ok: true, action, changed: result.changed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/foreign key/i.test(message)) return NextResponse.json({ error: "unknown paper" }, { status: 404 });
    throw error;
  }
}
