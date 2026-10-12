import { createHmac, timingSafeEqual } from "node:crypto";
import type { ActionKind } from "./types";

export type ActionClaim = { p: string; b: string; a: ActionKind };

const VALID_DAYS = 30;
const ACTIONS: readonly string[] = ["READ", "CLIENT", "SKIP"];

// Read directly so pages that only verify links do not need the full app environment.
function secret(): string {
  const value = process.env.ACTION_LINK_SECRET;
  if (!value || value.length < 32) throw new Error("ACTION_LINK_SECRET must be at least 32 characters");
  return value;
}

const mac = (payload: string) => createHmac("sha256", secret()).update(payload).digest();

export function signAction({ p, b, a }: ActionClaim, now = Date.now()): string {
  const e = Math.floor(now / 1000) + VALID_DAYS * 86_400;
  const payload = Buffer.from(JSON.stringify({ p, b, a, e })).toString("base64url");
  return `${payload}.${mac(payload).toString("base64url")}`;
}

export function verifyAction(token: string, now = Date.now()): ActionClaim | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  // Compared as canonical base64url text, so changing the unused low bits of the last character fails too.
  const expected = Buffer.from(mac(payload).toString("base64url"));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof claim.p !== "string" || typeof claim.b !== "string" || typeof claim.e !== "number") return null;
    if (typeof claim.a !== "string" || !ACTIONS.includes(claim.a)) return null;
    if (claim.e * 1000 < now) return null;
    return { p: claim.p, b: claim.b, a: claim.a as ActionKind };
  } catch {
    return null;
  }
}
