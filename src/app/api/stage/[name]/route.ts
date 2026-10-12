import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { isStageName, runStage, type StageName } from "@/lib/pipeline/stages";

// Node.js is the default runtime; `export const runtime` is rejected when cacheComponents is on.
export const maxDuration = 300;

const digest = (value: string) => createHash("sha256").update(value).digest();

// Comparing fixed-length digests keeps the check constant-time regardless of the header length.
function secretMatches(header: string | null): boolean {
  if (!header) return false;
  return timingSafeEqual(digest(header), digest(env.CRON_SECRET));
}

// Vercel Cron issues GET with `Authorization: Bearer <CRON_SECRET>`; extract the token for the same check.
function bearerToken(header: string | null): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

type StageParams = { params: Promise<{ name: string }> };

function accept(name: StageName): NextResponse {
  after(async () => {
    const outcome = await runStage(name);
    console.log(`stage ${name}: ${outcome.status} items=${outcome.items}`);
  });
  return NextResponse.json({ accepted: name }, { status: 202 });
}

export async function POST(request: NextRequest, { params }: StageParams) {
  if (!secretMatches(request.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { name } = await params;
  if (!isStageName(name)) {
    return NextResponse.json({ error: "unknown stage" }, { status: 404 });
  }
  return accept(name);
}

// Only the heartbeat is exposed to Vercel Cron; every other stage stays POST-only.
export async function GET(request: NextRequest, { params }: StageParams) {
  if (!secretMatches(bearerToken(request.headers.get("authorization")))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { name } = await params;
  if (name !== "heartbeat") {
    return NextResponse.json({ error: "unknown stage" }, { status: 404 });
  }
  return accept(name);
}
