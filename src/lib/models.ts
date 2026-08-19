import { activeKeys } from "@/lib/api-keys";
import { FALLBACK_MODELS } from "@/lib/model-catalog";
import type { ApiKeyEntry, ApiProvider } from "@/lib/types";
import { useAppStore } from "@/store/use-app-store";

export { FALLBACK_MODELS };

export const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENAI_API_BASE = "https://api.openai.com/v1";
const MISTRAL_API_BASE = "https://api.mistral.ai/v1";

type GeminiModelEntry = {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
  supportedActions?: string[];
  supportedInputModalities?: string[];
  version?: string;
  description?: string;
};

const GEMINI_BLOCKLIST =
  /preview|experimental|thinking|embedding|embed|imagen|veo|aqa|draft|deprecated|beta|live|realtime|tts|audio|voice|^gemini-1\.0/i;

function isGeminiVisionModel(entry: GeminiModelEntry): boolean {
  const name = entry.name?.replace(/^models\//, "") ?? "";
  if (!/^gemini-\d/.test(name)) return false;
  if (GEMINI_BLOCKLIST.test(name)) return false;
  const methods =
    entry.supportedGenerationMethods ?? entry.supportedActions ?? [];
  if (methods.length > 0 && !methods.includes("generateContent")) {
    return false;
  }
  const modalities = entry.supportedInputModalities;
  if (
    Array.isArray(modalities) &&
    modalities.length > 0 &&
    !modalities.some((modality) => modality.toUpperCase().includes("IMAGE"))
  ) {
    return false;
  }
  return true;
}

function geminiVersionRank(id: string): number {
  const match = id.match(/^gemini-(\d+)\.(\d+)/);
  if (!match) return 0;
  return Number(match[1]) * 1000 + Number(match[2]) * 100;
}

// Practical-speed tier for Gemini: flash is the fastest model with sufficient
// vision quality, then flash-lite (fastest, lighter vision), then pro (slower,
// strongest vision). Newer versions win within a tier.
function geminiSpeedTier(id: string): number {
  if (/flash-lite/.test(id)) return 1;
  if (/flash/.test(id)) return 0;
  if (/pro/.test(id)) return 2;
  if (/nano/.test(id)) return 3;
  return 4;
}

// Ranking for Gemini models: newer versions win, then within the same version
// flash (best speed/quality balance) > flash-lite (fastest, lighter) > pro
// (slowest, strongest). Lower rank = higher priority.
function geminiSpeedRank(id: string): number {
  const version = geminiVersionRank(id);
  const tier = geminiSpeedTier(id);
  return -(version * 10 + tier);
}

// Higher tier = higher vision/metadata quality. Used by the queue to jump to
// the next higher-quality model when the fastest model fails validation.
export function modelQualityTier(provider: ApiProvider, model: string): number {
  if (provider === "gemini") {
    if (/pro/.test(model)) return 3;
    if (/flash-lite/.test(model)) return 1;
    if (/flash/.test(model)) return 2;
    if (/nano/.test(model)) return 0;
    return 2;
  }
  if (provider === "openai") {
    return /(?:-mini|-turbo|-flash)/i.test(model) ? 1 : 2;
  }
  if (provider === "mistral") {
    return /12b|medium/i.test(model) ? 1 : 2;
  }
  return 2;
}

const OPENAI_VISION_PRIORITY: Record<string, number> = {
  "gpt-5-mini": 1,
  "gpt-4.1-mini": 2,
  "gpt-4o-mini": 3,
  "gpt-5": 4,
  "gpt-4.1": 5,
  "gpt-4o": 6,
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
    .sort((a, b) => geminiSpeedRank(a) - geminiSpeedRank(b));
}

export async function discoverKeyModels(
  apiKey: string
): Promise<string[]> {
  const models = await fetchGeminiModels(apiKey);
  if (models.length === 0) {
    throw new Error("No compatible Gemini vision models found for this key");
  }
  return models;
}

export async function refreshKeyModels(
  entryId: string
): Promise<string[]> {
  const store = useAppStore.getState();
  const entry = store.apiKeys.find((k) => k.id === entryId);
  if (!entry) throw new Error("Key not found");
  const models = await discoverKeyModels(entry.key);
  store.updateApiKey(entryId, {
    models,
    modelsFetchedAt: Date.now(),
  });
  return models;
}

export async function refreshAllGeminiModels(): Promise<{
  refreshed: string[];
  failed: string[];
}> {
  const store = useAppStore.getState();
  const keys = activeKeys(store.apiKeys, "gemini");
  const refreshed: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    keys.map(async (key) => {
      try {
        const models = await discoverKeyModels(key.key);
        store.updateApiKey(key.id, {
          models,
          modelsFetchedAt: Date.now(),
        });
        refreshed.push(key.id);
      } catch (error) {
        console.warn(`[Models] Failed to refresh models for ${key.id}`, error);
        failed.push(key.id);
      }
    })
  );
  return { refreshed, failed };
}

export function modelsForKey(
  entry: Pick<ApiKeyEntry, "models" | "modelStates">,
  now = Date.now()
): string[] {
  const models = entry.models && entry.models.length > 0 ? entry.models : [];
  if (models.length === 0) return [];
  return models.filter((model) => !modelBlockedUntil(entry, model, now));
}

export function modelBlockedUntil(
  entry: Pick<ApiKeyEntry, "models" | "modelStates">,
  model: string,
  now = Date.now()
): number | null {
  const state = entry.modelStates?.[model];
  if (!state || state.until == null) return null;
  if (state.until <= now) return null;
  return state.until;
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
