import { createHash } from "node:crypto";
import { headers } from "next/headers";

// The key the PIN backoff counts against. Vercel overwrites x-forwarded-for with the real client address,
// so the first entry is trustworthy there. With no address at all, each client gets its own key from a hash
// of its request fingerprint instead of one shared "unknown" key, which a single attacker could lock for
// everyone, the owner included.
export async function clientKey(): Promise<string> {
  const list = await headers();
  const ip = list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip")?.trim();
  if (ip) return ip.slice(0, 64);
  const fingerprint = [list.get("user-agent"), list.get("accept-language")].map((value) => value ?? "").join("\n");
  return `noip:${createHash("sha256").update(fingerprint).digest("hex").slice(0, 32)}`;
}
