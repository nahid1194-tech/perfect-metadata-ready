import type { ApiKeyEntry, KeyHealthCheck, KeyHealthStatus } from "@/lib/types";
import {
  clearKeyCooldown,
  markKeyRateLimited,
} from "@/lib/api-keys";
import { useAppStore } from "@/store/use-app-store";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const DEFAULT_HEALTH_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

export const QUOTA_COOLDOWN_MS = 30 * 60 * 1000;
export const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
export const INVALID_KEY_COOLDOWN_MS = 5 * 60 * 1000;

const recheckTimers = new Map<string, ReturnType<typeof setTimeout>>();

type Classified = {
  status: KeyHealthStatus;
  message: string;
};

export function classifyGeminiError(
  status: number,
  code: string | null,
  message: string
): Classified {
  const text = `${code ?? ""} ${message}`.toLowerCase();

  if (status === 401) {
    return {
      status: "invalid-key",
      message: "The API key is invalid or revoked.",
    };
  }

  if (status === 403) {
    if (/disabled|not\s*been\s*enabled|enable\s+the|billing\s*is\s*not\s*active/i.test(text)) {
      return {
        status: "api-disabled",
        message:
          "The Generative Language (Gemini) API is not enabled for this project.",
      };
    }
    return {
      status: "permission-denied",
      message:
        "The API key does not have permission to access this API/model.",
    };
  }

  if (status === 404) {
    return {
      status: "model-unavailable",
      message: "The API key works, but the requested model is unavailable.",
    };
  }

  if (status === 429 || /resource_exhausted/i.test(text)) {
    if (/(per\s*minute|per\s*second|too\s*many\s*requests|rate\s*limit|quota\s*for\s*this\s*model)/i.test(text)) {
      return {
        status: "rate-limited",
        message:
          "The API key is valid, but the current request rate/quota is temporarily limited.",
      };
    }
    return {
      status: "quota-exhausted",
      message: "The API key is valid, but its available quota has been exhausted.",
    };
  }

  if (status >= 500) {
    return {
      status: "server-error",
      message: "Temporary Gemini server problem. Please try again later.",
    };
  }

  if (status === 400 && /model/i.test(text) && /(not\s*found|does\s*not\s*exist|unavailable|no\s*longer)/i.test(text)) {
    return {
      status: "model-unavailable",
      message: "The API key works, but the requested model is unavailable.",
    };
  }

  if (status === 400 && /(api\s*key|key)\s*(invalid|not\s*valid)/i.test(text)) {
    return {
      status: "invalid-key",
      message: "The API key is invalid or revoked.",
    };
  }

  return {
    status: "server-error",
    message: `Unexpected API error (HTTP ${status}).`,
  };
}

function healthModelCandidates(): string[] {
  const cached = useAppStore.getState().providerModels.gemini;
  const cachedFlash = (cached ?? [])
    .filter((model) => /flash/i.test(model) && !/preview|experimental|thinking/i.test(model))
    .slice(0, 3);
  const candidates = [...cachedFlash, ...DEFAULT_HEALTH_MODELS];
  const seen = new Set<string>();
  return candidates.filter((model) => {
    if (seen.has(model)) return false;
    seen.add(model);
    return true;
  });
}

type RawResponse = {
  status: number;
  code: string | null;
  message: string;
  rawBody: string;
  latencyMs: number;
  model: string;
};

async function requestModelHealth(
  apiKey: string,
  model: string
): Promise<RawResponse> {
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(
      `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply with the single word: ok" }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 8,
          },
        }),
      }
    );
  } catch (error) {
    return {
      status: 0,
      code: null,
      message:
        error instanceof Error ? error.message : "Network request failed",
      rawBody: "",
      latencyMs: performance.now() - startedAt,
      model,
    };
  }

  const rawBody = await response.text();
  let code: string | null = null;
  let message = `HTTP ${response.status}`;
  try {
    const data = rawBody ? JSON.parse(rawBody) : null;
    const err = data?.error as
      | { code?: number; status?: string; message?: string }
      | undefined;
    if (err) {
      code = err.status ?? (err.code != null ? String(err.code) : null);
      message = err.message ?? message;
    }
  } catch {
    // Non-JSON body; keep the raw text as the message source.
  }

  return {
    status: response.status,
    code,
    message,
    rawBody: rawBody.slice(0, 2000),
    latencyMs: performance.now() - startedAt,
    model,
  };
}

export async function runGeminiHealthCheck(
  apiKey: string
): Promise<KeyHealthCheck> {  const candidates = healthModelCandidates();
  let lastResponse: RawResponse | null = null;
  let lastClassified: Classified | null = null;

  for (const model of candidates) {
    const response = await requestModelHealth(apiKey, model);
    lastResponse = response;

    if (response.status === 0) {
      lastClassified = {
        status: "server-error",
        message: `Could not reach the Gemini API — ${response.message}`,
      };
      continue;
    }

    if (response.status >= 200 && response.status < 300) {
      return {
        status: "working",
        message: "API key is valid and currently responding.",
        httpStatus: response.status,
        apiCode: response.code,
        rawDetail: response.rawBody,
        model: response.model,
        latencyMs: Math.round(response.latencyMs),
        checkedAt: Date.now(),
        cooldownUntil: null,
      };
    }

    lastClassified = classifyGeminiError(
      response.status,
      response.code,
      response.message
    );

    // A definitive key/account problem: stop trying other models.
    if (
      lastClassified.status === "invalid-key" ||
      lastClassified.status === "permission-denied" ||
      lastClassified.status === "api-disabled"
    ) {
      break;
    }
    // Model-level problems mean the key may still be fine; try the next model.
    if (
      lastClassified.status === "model-unavailable" &&
      candidates.length > 1
    ) {
      continue;
    }
    break;
  }

  const response = lastResponse ?? {
    status: 0,
    code: null,
    message: "No health check completed",
    rawBody: "",
    latencyMs: 0,
    model: candidates[0] ?? "unknown",
  };
  const classified = lastClassified ?? {
    status: "server-error" as KeyHealthStatus,
    message: "No health check completed.",
  };

  const isTransient =
    classified.status === "rate-limited" ||
    classified.status === "quota-exhausted" ||
    classified.status === "server-error";
  const cooldownUntil = isTransient
    ? Date.now() + cooldownMsForError(response)
    : null;

  return {
    status: classified.status,
    message: classified.message,
    httpStatus: response.status,
    apiCode: response.code,
    rawDetail:
      response.rawBody ||
      response.message ||
      `No response body (HTTP ${response.status}).`,
    model: response.model,
    latencyMs: Math.round(response.latencyMs),
    checkedAt: Date.now(),
    cooldownUntil,
  };
}

const OPENAI_API_BASE = "https://api.openai.com/v1";
const MISTRAL_API_BASE = "https://api.mistral.ai/v1";

async function requestProviderHealth(
  provider: "openai" | "mistral",
  apiKey: string
): Promise<KeyHealthCheck> {
  const base = provider === "openai" ? OPENAI_API_BASE : MISTRAL_API_BASE;
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:
          provider === "openai" ? "gpt-4o-mini" : "pixtral-12b-2409",
        max_tokens: 8,
        messages: [{ role: "user", content: "Say ok" }],
      }),
    });
  } catch (error) {
    return {
      status: "server-error",
      message: `Could not reach the ${provider === "openai" ? "OpenAI" : "Mistral"} API — ${
        error instanceof Error ? error.message : "Network request failed"
      }`,
      httpStatus: 0,
      apiCode: null,
      rawDetail:
        error instanceof Error ? error.message : "Network request failed",
      model: null,
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt: Date.now(),
      cooldownUntil: null,
    };
  }

  const rawBody = await response.text();
  let code: string | null = null;
  let message = `HTTP ${response.status}`;
  try {
    const data = rawBody ? JSON.parse(rawBody) : null;
    const err = data?.error as
      | { code?: string | number | null; message?: string; type?: string }
      | undefined;
    if (err) {
      code =
        err.code != null
          ? String(err.code)
          : err.type
            ? String(err.type)
            : null;
      message = err.message ?? message;
    }
  } catch {
    // Non-JSON body; keep raw text.
  }

  if (response.status >= 200 && response.status < 300) {
    return {
      status: "working",
      message: "API key is valid and currently responding.",
      httpStatus: response.status,
      apiCode: code,
      rawDetail: rawBody.slice(0, 2000),
      model: null,
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt: Date.now(),
      cooldownUntil: null,
    };
  }

  const classified = classifyGeminiError(response.status, code, message);
  const isTransient =
    classified.status === "rate-limited" ||
    classified.status === "quota-exhausted" ||
    classified.status === "server-error";
  const cooldownUntil = isTransient
    ? Date.now() +
      cooldownMsForError({
        status: response.status,
        code,
        message,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
      })
    : null;

  return {
    status: classified.status,
    message: classified.message,
    httpStatus: response.status,
    apiCode: code,
    rawDetail:
      rawBody ||
      message ||
      `No response body (HTTP ${response.status}).`,
    model: null,
    latencyMs: Math.round(performance.now() - startedAt),
    checkedAt: Date.now(),
    cooldownUntil,
  };
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export async function testKeyHealth(
  entry: Pick<ApiKeyEntry, "provider" | "key">
): Promise<KeyHealthCheck> {
  if (entry.provider === "gemini") {
    return runGeminiHealthCheck(entry.key);
  }
  return requestProviderHealth(entry.provider, entry.key);
}

export function applyHealthResult(entryId: string, check: KeyHealthCheck): void {
  const store = useAppStore.getState();
  const entry = store.apiKeys.find((item) => item.id === entryId);
  if (!entry) return;

  store.updateApiKey(entryId, { health: check });

  if (check.status === "working") {
    clearKeyCooldown(entryId);
    const timer = recheckTimers.get(entryId);
    if (timer) {
      clearTimeout(timer);
      recheckTimers.delete(entryId);
    }
    return;
  }

  if (check.cooldownUntil) {
    markKeyRateLimited(entryId, check.cooldownUntil);
    scheduleKeyAutoRecheck(entryId, check.cooldownUntil - Date.now());
  }
}

export function applyGenerationFailure(
  entryId: string,
  error: unknown
): void {
  const store = useAppStore.getState();
  const entry = store.apiKeys.find((item) => item.id === entryId);
  if (!entry) return;

  const err =
    error != null && typeof error === "object"
      ? (error as {
          status?: number;
          code?: string;
          message?: string;
          retryAfterMs?: number;
        })
      : null;
  const status = err?.status ?? 0;
  const code = err?.code ?? null;
  const message = err?.message ?? "";

  const classified = classifyGeminiError(status, code, message);
  const isTransient =
    classified.status === "rate-limited" ||
    classified.status === "quota-exhausted" ||
    classified.status === "server-error";
  const cooldownUntil = isTransient
    ? Date.now() +
      cooldownMsForError({
        status,
        code,
        message,
        retryAfterMs: err?.retryAfterMs,
      })
    : null;

  const check: KeyHealthCheck = {
    status: classified.status,
    message: classified.message,
    httpStatus: status || null,
    apiCode: code,
    rawDetail: message || "",
    model: null,
    latencyMs: null,
    checkedAt: Date.now(),
    cooldownUntil,
  };

  store.updateApiKey(entryId, { health: check });

  if (cooldownUntil) {
    markKeyRateLimited(entryId, cooldownUntil);
    scheduleKeyAutoRecheck(entryId, cooldownUntil - Date.now());
  }
}

export function applyGenerationSuccess(entryId: string): void {
  const store = useAppStore.getState();
  const entry = store.apiKeys.find((item) => item.id === entryId);
  if (!entry) return;

  clearKeyCooldown(entryId);
  const timer = recheckTimers.get(entryId);
  if (timer) {
    clearTimeout(timer);
    recheckTimers.delete(entryId);
  }

  if (entry.health?.status === "working") return;

  store.updateApiKey(entryId, {
    health: {
      status: "working",
      message: "API key is valid and currently responding.",
      httpStatus: 200,
      apiCode: null,
      rawDetail: "",
      model: null,
      latencyMs: null,
      checkedAt: Date.now(),
      cooldownUntil: null,
    },
  });
}

export function markModelUnavailable(
  entryId: string,
  modelId: string,
  until: number,
  reason: "rate-limited" | "quota-exhausted" | "model-unavailable" | "server-error"
): void {
  const store = useAppStore.getState();
  const entry = store.apiKeys.find((item) => item.id === entryId);
  if (!entry) return;
  const modelStates = { ...(entry.modelStates ?? {}) };
  modelStates[modelId] = { until, reason };
  store.updateApiKey(entryId, { modelStates });
}

export function clearModelUnavailable(
  entryId: string,
  modelId: string
): void {
  const store = useAppStore.getState();
  const entry = store.apiKeys.find((item) => item.id === entryId);
  if (!entry || !entry.modelStates) return;
  const modelStates = { ...entry.modelStates };
  delete modelStates[modelId];
  store.updateApiKey(entryId, { modelStates });
}

export function clearAllModelStates(entryId: string): void {
  const store = useAppStore.getState();
  const entry = store.apiKeys.find((item) => item.id === entryId);
  if (!entry) return;
  store.updateApiKey(entryId, { modelStates: {} });
}

export function modelUnavailableUntil(
  entry: Pick<ApiKeyEntry, "modelStates">,
  modelId: string,
  now = Date.now()
): number | null {
  const state = entry.modelStates?.[modelId];
  if (!state || state.until == null) return null;
  if (state.until <= now) return null;
  return state.until;
}

export function availableModelsFor(
  entry: Pick<ApiKeyEntry, "models" | "modelStates">,
  models: string[],
  now = Date.now()
): string[] {
  const list = entry.models && entry.models.length > 0 ? entry.models : models;
  return list.filter((model) => modelUnavailableUntil(entry, model, now) == null);
}

export function summarizeModelHealth(
  entry: Pick<ApiKeyEntry, "models" | "modelStates">,
  now = Date.now()
): {
  available: number;
  healthy: number;
  rateLimited: number;
  quotaExhausted: number;
  unavailable: number;
} {
  const models = entry.models && entry.models.length > 0 ? entry.models : [];
  const states = entry.modelStates ?? {};
  let rateLimited = 0;
  let quotaExhausted = 0;
  let unavailable = 0;
  for (const model of models) {
    const state = states[model];
    if (!state || state.until == null || state.until <= now) continue;
    if (state.reason === "rate-limited") rateLimited++;
    else if (state.reason === "quota-exhausted") quotaExhausted++;
    else unavailable++;
  }
  return {
    available: models.length,
    healthy: models.length - rateLimited - quotaExhausted - unavailable,
    rateLimited,
    quotaExhausted,
    unavailable,
  };
}

export function scheduleKeyAutoRecheck(
  entryId: string,
  delayMs: number
): void {
  const existing = recheckTimers.get(entryId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    recheckTimers.delete(entryId);
    const store = useAppStore.getState();
    const entry = store.apiKeys.find((item) => item.id === entryId);
    if (!entry || !entry.enabled) return;
    void (async () => {
      const check = await runGeminiHealthCheck(entry.key);
      applyHealthResult(entryId, check);
    })();
  }, Math.max(1000, delayMs));

  recheckTimers.set(entryId, timer);
}

export function cancelKeyAutoRecheck(entryId: string): void {
  const timer = recheckTimers.get(entryId);
  if (timer) {
    clearTimeout(timer);
    recheckTimers.delete(entryId);
  }
}

export function cooldownMsForError(
  error: unknown
): number {
  const err =
    error != null && typeof error === "object"
      ? (error as {
          status?: number;
          message?: string;
          code?: string | null;
          retryAfterMs?: number;
        })
      : null;
  if (err?.retryAfterMs && err.retryAfterMs > 0) return err.retryAfterMs;
  if (err?.status === 429) {
    const text = `${err.code ?? ""} ${err.message ?? ""}`.toLowerCase();
    if (/daily|per\s*day|quota|exhausted|billing/i.test(text)) {
      return QUOTA_COOLDOWN_MS;
    }
    return RATE_LIMIT_COOLDOWN_MS;
  }
  if (err?.status === 401 || err?.status === 403) {
    return INVALID_KEY_COOLDOWN_MS;
  }
  return RATE_LIMIT_COOLDOWN_MS;
}

export function maskKeyBullets(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

export type KeyHealthSummary = {
  total: number;
  working: number;
  rateLimited: number;
  quotaExhausted: number;
  invalid: number;
  permissionDenied: number;
  apiDisabled: number;
  modelUnavailable: number;
  serverError: number;
  notTested: number;
};

export function summarizeKeyHealth(
  keys: ApiKeyEntry[]
): KeyHealthSummary {
  const summary: KeyHealthSummary = {
    total: keys.length,
    working: 0,
    rateLimited: 0,
    quotaExhausted: 0,
    invalid: 0,
    permissionDenied: 0,
    apiDisabled: 0,
    modelUnavailable: 0,
    serverError: 0,
    notTested: 0,
  };

  for (const key of keys) {
    const status = key.health?.status ?? "not-tested";
    switch (status) {
      case "working":
        summary.working++;
        break;
      case "rate-limited":
        summary.rateLimited++;
        break;
      case "quota-exhausted":
        summary.quotaExhausted++;
        break;
      case "invalid-key":
        summary.invalid++;
        break;
      case "permission-denied":
        summary.permissionDenied++;
        break;
      case "api-disabled":
        summary.apiDisabled++;
        break;
      case "model-unavailable":
        summary.modelUnavailable++;
        break;
      case "server-error":
        summary.serverError++;
        break;
      default:
        summary.notTested++;
    }
  }

  return summary;
}

export function latestHealthCheckTime(keys: ApiKeyEntry[]): number | null {
  let latest: number | null = null;
  for (const key of keys) {
    const checkedAt = key.health?.checkedAt;
    if (checkedAt && (latest === null || checkedAt > latest)) {
      latest = checkedAt;
    }
  }
  return latest;
}

export function formatTimeAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
