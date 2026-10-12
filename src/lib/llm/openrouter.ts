import { type OpenRouterChatSettings, createOpenRouter } from "@openrouter/ai-sdk-provider";

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

export type ChatModelOptions = {
  // OpenRouter reasoning control; leaving it out keeps the model's default reasoning.
  reasoning?: OpenRouterChatSettings["reasoning"];
};

export function chatModel(id: string, options: ChatModelOptions = {}) {
  assertModelAllowed(id);
  return openrouter.chat(id, {
    usage: { include: true },
    ...(options.reasoning ? { reasoning: options.reasoning } : {}),
  });
}

export function embedModel(id: string) {
  assertModelAllowed(id);
  return openrouter.textEmbeddingModel(id);
}
