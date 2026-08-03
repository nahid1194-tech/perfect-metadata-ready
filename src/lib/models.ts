import { activeKeys } from "@/lib/api-keys";
import { FALLBACK_MODELS } from "@/lib/model-catalog";
import type { ApiProvider } from "@/lib/types";
import { useAppStore } from "@/store/use-app-store";

export { FALLBACK_MODELS };

export const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENAI_API_BASE = "https://api.openai.com/v1";
const MISTRAL_API_BASE = "https://api.mistral.ai/v1";

type GeminiModelEntry = {
  name?: string;
  supportedGenerationMethods?: string[];
};

const GEMINI_BLOCKLIST =
  /preview|experimental|thinking|embedding|embed|imagen|veo|aqa|draft|deprecated|beta|live|realtime|tts|audio|voice|code|search|^gemini-1\.0/i;

function isGeminiVisionModel(entry: GeminiModelEntry): boolean {
  const name = entry.name?.replace(/^models\//, "") ?? "";
  if (!/^gemini-\d/.test(name)) return false;
  if (GEMINI_BLOCKLIST.test(name)) return false;
  const methods = entry.supportedGenerationMethods;
  if (methods && methods.length > 0 && !methods.includes("generateContent")) {
    return false;
  }
  return true;
}

function geminiPriority(id: string): number {
  if (id.includes("2.5")) return id.includes("pro") ? 1 : 2;
  if (id.includes("2.0")) return id.includes("pro") ? 3 : 4;
  if (id.includes("1.5")) return id.includes("pro") ? 5 : 6;
  return 10;
}

const OPENAI_VISION_PRIORITY: Record<string, number> = {
  "gpt-5": 1,
  "gpt-5-mini": 2,
  "gpt-4.1": 3,
  "gpt-4.1-mini": 4,
  "gpt-4o": 5,
  "gpt-4o-mini": 6,
  "gpt-4-turbo": 7,
};

function mistralPriority(id: string): number {
  if (id.includes("large")) return 1;
  if (id.includes("12b")) return 2;
  return 3;
}

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
  const response = await fetch(
    `${GEMINI_API_BASE}/models?key=${encodeURIComponent(apiKey)}`,
    { method: "GET" }
  );
  if (!response.ok) {
    throw new Error(`Gemini model fetch failed (${response.status})`);
  }
  const data = (await response.json()) as { models?: GeminiModelEntry[] } | null;
  return (data?.models ?? [])
    .filter(isGeminiVisionModel)
    .map((entry) => entry.name?.replace(/^models\//, "") ?? "")
    .sort((a, b) => geminiPriority(a) - geminiPriority(b));
}

async function fetchOpenAIModels(apiKey: string): Promise<string[]> {
  const response = await fetch(`${OPENAI_API_BASE}/models`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`OpenAI model fetch failed (${response.status})`);
  }
  const data = (await response.json()) as { data?: Array<{ id?: string }> } | null;
  return (data?.data ?? [])
    .map((entry) => entry.id ?? "")
    .filter((id) => id in OPENAI_VISION_PRIORITY)
    .sort(
      (a, b) => OPENAI_VISION_PRIORITY[a] - OPENAI_VISION_PRIORITY[b]
    );
}

async function fetchMistralModels(apiKey: string): Promise<string[]> {
  const response = await fetch(`${MISTRAL_API_BASE}/models`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Mistral model fetch failed (${response.status})`);
  }
  const data = (await response.json()) as { data?: Array<{ id?: string }> } | null;
  return (data?.data ?? [])
    .map((entry) => entry.id ?? "")
    .filter((id) => /^pixtral/i.test(id))
    .sort((a, b) => mistralPriority(a) - mistralPriority(b));
}

async function fetchProviderModels(
  provider: ApiProvider,
  apiKey: string
): Promise<string[]> {
  switch (provider) {
    case "gemini":
      return fetchGeminiModels(apiKey);
    case "openai":
      return fetchOpenAIModels(apiKey);
    case "mistral":
      return fetchMistralModels(apiKey);
  }
}

export function modelListFor(provider: ApiProvider): string[] {
  const cached = useAppStore.getState().providerModels[provider];
  if (cached && cached.length > 0) return cached;
  return FALLBACK_MODELS[provider];
}

export function bestModelFor(provider: ApiProvider): string {
  return modelListFor(provider)[0] ?? "";
}

export function isModelCacheStale(
  provider: ApiProvider,
  now = Date.now()
): boolean {
  const fetchedAt = useAppStore.getState().providerModelsFetchedAt[provider];
  return fetchedAt == null || now - fetchedAt > MODEL_CACHE_TTL_MS;
}

export async function refreshProviderModels(
  provider: ApiProvider,
  opts: { force?: boolean } = {}
): Promise<string[]> {
  if (!opts.force && !isModelCacheStale(provider)) {
    return modelListFor(provider);
  }
  const store = useAppStore.getState();
  const keys = activeKeys(store.apiKeys, provider);
  if (keys.length === 0) return modelListFor(provider);
  try {
    const models = await fetchProviderModels(provider, keys[0].key);
    if (models.length > 0) {
      store.setProviderModels(provider, models, Date.now());
      return models;
    }
  } catch (error) {
    console.warn(`[Models] Failed to refresh ${provider} model list`, error);
  }
  return modelListFor(provider);
}

export async function ensureModelCache(): Promise<void> {
  await Promise.all(
    (["gemini", "openai", "mistral"] as ApiProvider[]).map((provider) =>
      refreshProviderModels(provider)
    )
  );
}
