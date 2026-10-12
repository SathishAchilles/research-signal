import type { z } from "zod";
import { sourceKind, sourceRole } from "@/db/schema";
import { env } from "@/lib/env";

export type SourceKind = (typeof sourceKind.enumValues)[number];
export type SourceRole = (typeof sourceRole.enumValues)[number];

export type ConnectionResult = { ok: boolean; latencyMs: number; sample?: string; error?: string };

export interface SourceAdapter<P> {
  kind: SourceKind;
  paramsSchema: z.ZodType<P>;
  testConnection(params: P, secret?: string): Promise<ConnectionResult>;
}

export class SourceUnavailable extends Error {
  constructor(
    readonly kind: SourceKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${kind} unavailable: ${message}`, options);
    this.name = "SourceUnavailable";
  }
}

export const USER_AGENT = `research-signal/1.0 (mailto:${env.CONTACT_EMAIL})`;
export const REQUEST_TIMEOUT_MS = 30_000;
export const TEST_TIMEOUT_MS = 10_000;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function httpGet(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, {
    headers: { "user-agent": USER_AGENT, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

// Removes tags, decodes entities and collapses whitespace.
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function timed(fn: () => Promise<string | undefined>): Promise<ConnectionResult> {
  const started = Date.now();
  try {
    const sample = await fn();
    return { ok: true, latencyMs: Date.now() - started, sample };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: errorMessage(error) };
  }
}
