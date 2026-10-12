import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "rs_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

const ALGORITHM = "HS256";
const SUBJECT = "owner";

// Read directly so the proxy can import this module without the full app environment.
function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function createSession(): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(SUBJECT)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

export async function readSession(cookie?: string): Promise<boolean> {
  if (!cookie) return false;
  try {
    const { payload } = await jwtVerify(cookie, secretKey(), { algorithms: [ALGORITHM] });
    return payload.sub === SUBJECT;
  } catch {
    return false;
  }
}
