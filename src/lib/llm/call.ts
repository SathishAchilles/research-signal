import { APICallError, RetryError } from "ai";
import { db } from "@/db/client";
import { llmCalls } from "@/db/schema";

export class LlmCreditsExhausted extends Error {
  constructor(message = "OpenRouter credits exhausted (HTTP 402)", options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmCreditsExhausted";
  }
}

const RETRY_DELAYS_MS = [2000, 4000, 8000];

type OpenRouterUsage = {
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
  costDetails?: { upstreamInferenceCost?: number };
};

type CallMeta = {
  usage?: unknown;
  providerMetadata?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

function statusOf(error: unknown): number | undefined {
  const inner = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(inner)) return inner.statusCode;
  return undefined;
}

function isRetryable(status: number | undefined): boolean {
  return status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// With BYOK, `cost` is only OpenRouter's fee and the provider's charge is reported separately.
function totalCost(usage: OpenRouterUsage | undefined): number | null {
  const cost = num(usage?.cost);
  const upstream = num(usage?.costDetails?.upstreamInferenceCost);
  if (upstream !== null && upstream > (cost ?? 0)) return (cost ?? 0) + upstream;
  return cost;
}

function extract(result: CallMeta) {
  const meta = result.providerMetadata?.openrouter as
    | { provider?: string; usage?: OpenRouterUsage }
    | undefined;
  const usage = (result.usage ?? {}) as Record<string, unknown>;
  return {
    provider: meta?.provider || null,
    promptTokens: num(meta?.usage?.promptTokens) ?? num(usage.inputTokens) ?? num(usage.tokens),
    completionTokens: num(meta?.usage?.completionTokens) ?? num(usage.outputTokens),
    costUsd: totalCost(meta?.usage),
  };
}

async function logCall(row: typeof llmCalls.$inferInsert): Promise<void> {
  try {
    await db.insert(llmCalls).values(row);
  } catch (error) {
    console.error(`llm_calls insert failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function llmCall<T>(
  stage: string,
  model: string,
  fn: () => Promise<T & CallMeta>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await fn();
      await logCall({ stage, model, status: "ok", ...extract(result) });
      return result;
    } catch (error) {
      const status = statusOf(error);
      if (status === 402) {
        await logCall({ stage, model, status: "credits_exhausted" });
        throw new LlmCreditsExhausted(undefined, { cause: error });
      }
      if (isRetryable(status) && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      await logCall({ stage, model, status: status ? `error_${status}` : "error" });
      throw error;
    }
  }
}
