import { createOpenRouter } from "@openrouter/ai-sdk-provider";

export const GOOGLE_PROVIDERS = ["google-vertex", "google-ai-studio"] as const;

export const openrouter = createOpenRouter({
  // Read directly so importing this module never requires the full app environment.
  apiKey: process.env.OPENROUTER_API_KEY,
  extraBody: {
    provider: {
      only: [...GOOGLE_PROVIDERS],
      allow_fallbacks: false,
      require_parameters: true,
    },
  },
});

export function assertModelAllowed(id: string): void {
  if (!id.startsWith("google/")) throw new Error("Model must start with google/");
}

export function chatModel(id: string) {
  assertModelAllowed(id);
  return openrouter.chat(id, { usage: { include: true } });
}

export function embedModel(id: string) {
  assertModelAllowed(id);
  return openrouter.textEmbeddingModel(id);
}
