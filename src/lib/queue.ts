import {
  activeKeys,
  keyCooldownUntil,
  markKeyRateLimited,
  maskKey,
  pruneKeyCooldowns,
  rotateKeys,
} from "@/lib/api-keys";
import { resultCacheKey } from "@/lib/cache";
import {
  applyGenerationFailure,
  applyGenerationSuccess,
  availableModelsFor,
  clearModelUnavailable,
  cooldownMsForError,
  markModelUnavailable,
} from "@/lib/key-health";
import { devLog } from "@/lib/dev-log";
import {
  friendlyApiError,
  generateWithApi,
  generateWithMistral,
  generateWithOpenAI,
  isInvalidImageError,
  isKeyFailure,
  isModelUnavailable,
  isNetworkError,
  isQuotaExceeded,
  isRateLimited,
  MetadataQualityError,
  NoActiveKeyError,
  prepareImage,
  providerSwitchReason,
  RateLimitedError,
  rateLimitDelayMs,
  testGeminiConnection,
  testMistralConnection,
  testOpenAIConnection,
  warmUpProvider,
} from "@/lib/generate";
import {
  ensureModelCache,
  modelListFor,
  refreshKeyModels,
  refreshProviderModels,
} from "@/lib/models";
import { GEMINI_MULTI_MODEL_FALLBACK } from "@/lib/model-catalog";
import { backoffDelayMs } from "@/lib/rate-limiter";
import type {
  ApiKeyEntry,
  ApiProvider,
  GenerationResult,
  GenerationSettings,
  ImageAsset,
} from "@/lib/types";
import { useAppStore } from "@/store/use-app-store";
import { toast } from "@/store/use-toast-store";

let active = false;
let stopRequested = false;
let pauseRequested = false;
const activeControllers = new Map<string, AbortController>();

let preferredProvider: ApiProvider = "gemini";
let recoveryProbeRunning = false;
let backoffAttempt = 0;
const RECOVERY_PROBE_INTERVAL_MS = 30_000;

// Maximum number of images processed with a live AI request at the same time.
export const MAX_CONCURRENT_GENERATIONS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateDebug(
  activeProvider: ApiProvider | null,
  activeKeyIndex: number | null,
  activeKeyCount: number,
  activeModel: string | null,
  activeKeyMasked: string | null
): void {
  const store = useAppStore.getState();
  const remainingKeys =
    activeProvider && activeKeyIndex != null && activeKeyCount > 0
      ? activeKeyCount - activeKeyIndex
      : null;
  useAppStore.getState().setDebugStatus({
    activeProvider,
    activeKeyIndex,
    activeKeyCount,
    activeModel,
    activeKeyMasked,
    remainingKeys,
    fallbackActive:
      activeProvider !== null && activeProvider !== store.primaryProvider,
  });
}

function providerLabel(provider: ApiProvider): string {
  switch (provider) {
    case "gemini":
      return "Gemini";
    case "openai":
      return "OpenAI";
    case "mistral":
      return "Mistral AI";
  }
}

const PROVIDER_ORDER: ApiProvider[] = ["gemini", "openai", "mistral"];

function currentModel(provider: ApiProvider): string {
  if (provider === "gemini") return GEMINI_MULTI_MODEL_FALLBACK[0] ?? "";
  return modelListFor(provider)[0] ?? "";
}

function modelChoices(provider: ApiProvider): string[] {
  if (provider === "gemini") return GEMINI_MULTI_MODEL_FALLBACK;
  return modelListFor(provider);
}

let lastProviderSwitchToastAt = 0;
let lastApiKeySwitchToastAt = 0;

const keyDiscoveryAttempted = new Map<string, number>();
const KEY_DISCOVERY_RETRY_MS = 60_000;

async function resolveKeyModels(
  entry: ApiKeyEntry,
  fallbackModels: string[],
  now: number
): Promise<string[]> {
  if (entry.provider !== "gemini") return fallbackModels;

  const discovered =
    entry.models && entry.models.length > 0 ? entry.models : null;
  if (discovered) {
    return availableModelsFor(entry, discovered, now);
  }

  const lastAttempt = keyDiscoveryAttempted.get(entry.id) ?? 0;
  if (now - lastAttempt > KEY_DISCOVERY_RETRY_MS) {
    keyDiscoveryAttempted.set(entry.id, now);
    try {
      const discoveredNow = await refreshKeyModels(entry.id);
      const fresh =
        useAppStore.getState().apiKeys.find((k) => k.id === entry.id) ?? entry;
      const models =
        discoveredNow.length > 0 ? discoveredNow : fallbackModels;
      return availableModelsFor(fresh, models, now);
    } catch (error) {
      console.warn(
        `[Queue] Model discovery failed for key ${maskKey(entry.key)}, using curated fallback list`,
        error
      );
      return availableModelsFor(entry, fallbackModels, now);
    }
  }

  return availableModelsFor(entry, fallbackModels, now);
}

function logProviderState(
  provider: ApiProvider,
  keyIndex: number,
  keyCount: number,
  model: string,
  keyMasked: string
): void {
  console.log(
    `[Queue] Active provider: ${providerLabel(provider)} | key: ${keyMasked} | model: ${model}`
  );
  updateDebug(provider, keyIndex, keyCount, model, keyMasked);
}

function notifyProviderSwitch(
  from: ApiProvider,
  to: ApiProvider,
  reason: string,
  isRecovery = false
): void {
  console.log(
    `[Queue] Provider switch: ${providerLabel(from)} -> ${providerLabel(to)} | reason: ${reason}`
  );
  const now = Date.now();
  if (now - lastProviderSwitchToastAt < 15000) return;
  lastProviderSwitchToastAt = now;
  const message = isRecovery
    ? `${providerLabel(to)} is available again. Switched back to ${providerLabel(to)}.`
    : `${providerLabel(from)} rate-limited. Switched to ${providerLabel(to)}.`;
  toast("info", "Provider switched", message);
}

function notifyApiKeySwitch(provider: ApiProvider, nextKeyIndex: number): void {
  if (nextKeyIndex === 0) return;
  const now = Date.now();
  if (now - lastApiKeySwitchToastAt < 10000) return;
  lastApiKeySwitchToastAt = now;
  const message = `Switched to ${providerLabel(provider)} API Key #${nextKeyIndex + 1}.`;
  console.log(`[Queue] ${message}`);
  toast("info", "API key switched", message);
}

function sleepCancellable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForRateLimit(
  image: ImageAsset,
  error: RateLimitedError,
  controller: AbortController
): Promise<void> {
  const delayMs = Math.max(backoffDelayMs(backoffAttempt), error.delayMs);
  backoffAttempt++;
  const endAt = Date.now() + delayMs;
  const initialSeconds = Math.max(1, Math.ceil(delayMs / 1000));
  const message = `All available API keys are temporarily rate-limited. Retrying automatically in ${initialSeconds}s...`;
  console.log(
    `[Queue] All active API keys rate-limited, retrying automatically in ${initialSeconds}s`
  );
  updateDebug(
    null,
    null,
    activeKeys(useAppStore.getState().apiKeys).length,
    null,
    null
  );
  useAppStore.getState().patchQueueItem(image.id, {
    status: "retrying",
    error: null,
    statusMessage: message,
  });

  let lastShownSeconds = initialSeconds;
  while (Date.now() < endAt) {
    if (controller.signal.aborted) throw controller.signal.reason;
    while (pauseRequested) {
      if (controller.signal.aborted) throw controller.signal.reason;
      await sleep(160);
    }
    const remaining = Math.max(1, Math.ceil((endAt - Date.now()) / 1000));
    if (remaining !== lastShownSeconds) {
      lastShownSeconds = remaining;
      useAppStore.getState().patchQueueItem(image.id, {
        statusMessage: `All available API keys are temporarily rate-limited. Retrying automatically in ${remaining}s...`,
      });
    }
    await sleepCancellable(250, controller.signal);
  }
  useAppStore.getState().patchQueueItem(image.id, {
    status: "analyzing",
    statusMessage: null,
  });
}

function rebaseCachedResult(
  cached: GenerationResult,
  image: ImageAsset
): GenerationResult {
  return {
    ...cached,
    id: crypto.randomUUID(),
    imageId: image.id,
    imageName: image.name,
    createdAt: new Date().toISOString(),
  };
}

async function generateWithKeys(
  provider: ApiProvider,
  image: ImageAsset,
  settings: GenerationSettings,
  signal: AbortSignal
): Promise<GenerationResult> {
  const store = useAppStore.getState();
  const keys = activeKeys(store.apiKeys, provider);
  if (keys.length === 0) throw new NoActiveKeyError();

  const now = Date.now();
  pruneKeyCooldowns(now);
  const orderedKeys = rotateKeys(keys);

  const fallbackModels = modelChoices(provider);

  let sawRateLimit = false;
  let sawModelUnavailable = false;
  let waitUntil = Infinity;
  let nonRateLimitError: unknown = null;

  keyLoop:
  for (let keyIndex = 0; keyIndex < orderedKeys.length; keyIndex++) {
    const key = orderedKeys[keyIndex];
    const cooldownUntil = keyCooldownUntil(key.id, now);
    if (cooldownUntil) {
      sawRateLimit = true;
      waitUntil = Math.min(waitUntil, cooldownUntil);
      continue;
    }

    const models = await resolveKeyModels(key, fallbackModels, Date.now());
    if (models.length === 0) {
      console.warn(
        `[${provider}] No usable models for key ${keyIndex + 1}/${keys.length} (${maskKey(key.key)}), moving to the next key`
      );
      continue;
    }

    console.log(
      `[${provider}] Using API key ${keyIndex + 1}/${keys.length} (${maskKey(key.key)})`
    );
    updateDebug(
      provider,
      keyIndex,
      keys.length,
      models[0] ?? null,
      maskKey(key.key)
    );

    modelLoop:
    for (const model of models) {
      console.log(`[${provider}] Using model ${model}`);
      updateDebug(provider, keyIndex, keys.length, model, maskKey(key.key));
      let networkRetries = 0;
      for (;;) {
        try {
          const generate =
            provider === "gemini"
              ? generateWithApi
              : provider === "openai"
                ? generateWithOpenAI
                : generateWithMistral;
          devLog({
            event: "request-start",
            imageId: image.id,
            name: image.name,
            mime: image.type,
            size: image.size,
            provider,
            model,
            keyIndex: keyIndex + 1,
            keyCount: keys.length,
          });
          const result = await generate(image, key.key, model, settings, signal);
          clearModelUnavailable(key.id, model);
          applyGenerationSuccess(key.id);
          return result;
        } catch (error) {
          if (signal.aborted) throw error;

          if (isNetworkError(error) && networkRetries < 2) {
            networkRetries++;
            await sleepCancellable(1000, signal);
            continue;
          }
          if (isInvalidImageError(error)) throw error;
          if (error instanceof MetadataQualityError) {
            nonRateLimitError ??= error;
            devLog({
              event: "quality-retry",
              imageId: image.id,
              name: image.name,
              provider,
              model,
              reason: error.message,
            });
            continue modelLoop;
          }

          // Gemini per-key model fallback: mark the failing model as
          // temporarily unavailable for this key, then retry the next model
          // on the same key before moving to the next key. Only key-level
          // failures skip to the next key.
          if (provider === "gemini") {
            if (isRateLimited(error)) {
              const until = Date.now() + cooldownMsForError(error);
              sawRateLimit = true;
              waitUntil = Math.min(waitUntil, until);
              markModelUnavailable(
                key.id,
                model,
                until,
                isQuotaExceeded(error) ? "quota-exhausted" : "rate-limited"
              );
              console.warn(
                `[Gemini] Model ${model} rate-limited/quota exhausted (${maskKey(key.key)}), marking unavailable and retrying with the next model`
              );
              continue modelLoop;
            }
            if (isModelUnavailable(error)) {
              sawModelUnavailable = true;
              nonRateLimitError ??= error;
              markModelUnavailable(
                key.id,
                model,
                Date.now() + cooldownMsForError(error),
                "model-unavailable"
              );
              console.warn(
                `[Gemini] Model ${model} unavailable (${maskKey(key.key)}), marking unavailable and retrying with the next model`
              );
              continue modelLoop;
            }
            if (isKeyFailure(error)) {
              nonRateLimitError ??= error;
              applyGenerationFailure(key.id, error);
              console.warn(
                `[Gemini] API key ${maskKey(key.key)} failed, moving to the next key`
              );
              if (keyIndex < orderedKeys.length - 1) {
                notifyApiKeySwitch(provider, keyIndex + 1);
              }
              continue keyLoop;
            }
            nonRateLimitError ??= error;
            markModelUnavailable(
              key.id,
              model,
              Date.now() + cooldownMsForError(error),
              "server-error"
            );
            console.warn(
              `[Gemini] Model ${model} failed (${maskKey(key.key)}), marking unavailable and retrying with the next model`
            );
            continue modelLoop;
          }

          if (isRateLimited(error)) {
            const until = Date.now() + rateLimitDelayMs(error);
            sawRateLimit = true;
            waitUntil = Math.min(waitUntil, until);
            markKeyRateLimited(key.id, until);
            applyGenerationFailure(key.id, error);
            console.log(
              `[${provider}] Model ${model} rate-limited (${maskKey(key.key)}), switching to the next active key`
            );
            if (keyIndex < orderedKeys.length - 1) {
              notifyApiKeySwitch(provider, keyIndex + 1);
            }
            continue keyLoop;
          }
          if (isModelUnavailable(error)) {
            sawModelUnavailable = true;
            nonRateLimitError ??= error;
            applyGenerationFailure(key.id, error);
            console.log(
              `[${provider}] Model ${model} unavailable/busy, trying the next compatible model`
            );
            break;
          }
          if (isKeyFailure(error)) {
            nonRateLimitError ??= error;
            applyGenerationFailure(key.id, error);
            if (keyIndex < orderedKeys.length - 1) {
              notifyApiKeySwitch(provider, keyIndex + 1);
            }
            continue keyLoop;
          }
          nonRateLimitError ??= error;
          throw error;
        }
      }
    }
  }

  if (sawModelUnavailable) {
    console.log(
      `[${provider}] All compatible models failed, refreshing the model list`
    );
    void refreshProviderModels(provider, { force: true });
  }

  if (sawRateLimit && nonRateLimitError === null) {
    throw new RateLimitedError(Math.max(1, waitUntil - Date.now()));
  }
  throw nonRateLimitError ?? new NoActiveKeyError();
}

function isRetryableFailure(error: unknown): boolean {
  return (
    error instanceof RateLimitedError ||
    isRateLimited(error) ||
    isModelUnavailable(error) ||
    isNetworkError(error)
  );
}

function retryDelayFor(error: unknown): number {
  if (error instanceof RateLimitedError) return error.delayMs;
  return rateLimitDelayMs(error);
}

async function generateWithProviders(
  image: ImageAsset,
  settings: GenerationSettings,
  signal: AbortSignal
): Promise<GenerationResult> {
  const store = useAppStore.getState();
  const current: ApiProvider = preferredProvider;
  const rest = PROVIDER_ORDER.filter((provider) => provider !== current);

  const order: ApiProvider[] = [];
  if (activeKeys(store.apiKeys, current).length > 0) order.push(current);
  for (const provider of rest) {
    if (activeKeys(store.apiKeys, provider).length > 0) order.push(provider);
  }
  if (order.length === 0) throw new NoActiveKeyError();

  let sawRateLimit = false;
  let lastError: unknown = null;

  for (let index = 0; index < order.length; index++) {
    const provider = order[index];
    try {
      return await generateWithKeys(provider, image, settings, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      sawRateLimit ||= isRetryableFailure(error);
      lastError = error;
      if (index < order.length - 1) {
        const next = order[index + 1];
        preferredProvider = next;
        logProviderState(
          next,
          0,
          activeKeys(store.apiKeys, next).length,
          currentModel(next),
          maskKey(activeKeys(store.apiKeys, next)[0]?.key ?? "")
        );
        notifyProviderSwitch(provider, next, providerSwitchReason(error));
        toast(
          "info",
          "Using fallback provider",
          `Retrying image using ${providerLabel(next)}...`
        );
      }
    }
  }

  if (sawRateLimit) {
    throw new RateLimitedError(Math.max(1, retryDelayFor(lastError)));
  }
  throw lastError ?? new NoActiveKeyError();
}

async function recoveryProbeLoop(): Promise<void> {
  if (recoveryProbeRunning) return;
  recoveryProbeRunning = true;
  while (active && !stopRequested) {
    await sleep(RECOVERY_PROBE_INTERVAL_MS);
    if (!active || stopRequested) break;
    const store = useAppStore.getState();
    const primary = store.primaryProvider;
    if (preferredProvider !== primary) {
      const primaryKeys = activeKeys(store.apiKeys, primary);
      if (primaryKeys.length === 0) continue;
      const key = primaryKeys[0];
      const testConnection =
        primary === "gemini"
          ? testGeminiConnection
          : primary === "openai"
            ? testOpenAIConnection
            : testMistralConnection;
      try {
        await testConnection(key.key);
        const from = preferredProvider;
        preferredProvider = primary;
        logProviderState(
          primary,
          0,
          primaryKeys.length,
          currentModel(primary),
          maskKey(key.key)
        );
        notifyProviderSwitch(
          from,
          primary,
          `${providerLabel(primary)} became available again`,
          true
        );
      } catch {
        // Primary still unavailable; keep using the fallback.
      }
    }
  }
  recoveryProbeRunning = false;
}

async function processOne(
  image: ImageAsset,
  force = false
): Promise<"success" | "failed" | "cancelled"> {
  const store = useAppStore.getState();
  if (!store.images.some((item) => item.id === image.id)) {
    store.removeQueueItem(image.id);
    return "cancelled";
  }

  const controller = new AbortController();
  activeControllers.set(image.id, controller);
  const startedAtMs = performance.now();

  updateDebug(
    null,
    null,
    activeKeys(useAppStore.getState().apiKeys).length,
    null,
    null
  );

  store.patchQueueItem(image.id, {
    status: "analyzing",
    progress: 6,
    error: null,
    startedAt: Date.now(),
  });

  const ticker = setInterval(() => {
    const item = useAppStore.getState().queueItems[image.id];
    if (!item) return;
    const cap = item.status === "generating" ? 95 : 60;
    const next = Math.min(item.progress + Math.random() * 4, cap);
    useAppStore.getState().patchQueueItem(image.id, { progress: next });
  }, 220);

  let result: GenerationResult;
  try {
    const { settings } = useAppStore.getState();
    if (activeKeys(useAppStore.getState().apiKeys).length === 0) {
      throw new NoActiveKeyError();
    } else {
      const cacheKey = await resultCacheKey(image, settings);
      const cached = useAppStore.getState().resultCache[cacheKey];
      if (!force && cached) {
        result = rebaseCachedResult(cached, image);
      } else {
        for (;;) {
          try {
            result = await generateWithProviders(
              image,
              settings,
              controller.signal
            );
            break;
          } catch (error) {
            if (controller.signal.aborted) throw error;
            if (!(error instanceof RateLimitedError)) throw error;
            await waitForRateLimit(image, error, controller);
          }
        }
        if (!controller.signal.aborted) {
          useAppStore.getState().setResultCache(cacheKey, result);
        }
      }
    }
    if (controller.signal.aborted) {
      throw new DOMException("Cancelled", "AbortError");
    }
  } catch (error) {
    clearInterval(ticker);
    const aborted =
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError");
    if (aborted) {
      useAppStore.getState().patchQueueItem(image.id, {
        status: "cancelled",
        error: null,
        progress: 0,
        startedAt: undefined,
        statusMessage: null,
      });
    } else {
      useAppStore.getState().patchQueueItem(image.id, {
        status: "failed",
        error: friendlyApiError(error),
        progress: 0,
        startedAt: undefined,
        statusMessage: null,
      });
      if (error instanceof NoActiveKeyError) {
        pauseRequested = true;
        useAppStore.getState().setQueueState("paused");
        toast(
          "error",
          "No active API key available.",
          "Add or enable an API key, then resume the queue."
        );
      }
    }
    activeControllers.delete(image.id);
    return aborted ? "cancelled" : "failed";
  }

  clearInterval(ticker);
  backoffAttempt = 0;
  useAppStore.getState().patchQueueItem(image.id, {
    status: "generating",
    progress: 96,
  });

  const current = useAppStore.getState();
  const existing = current.results.find((item) => item.imageId === image.id);
  if (existing) {
    current.updateResult(existing.id, () => result);
  } else {
    current.addResult(result);
  }

  console.log(
    `[Perf] ${image.name}:total=${(performance.now() - startedAtMs).toFixed(0)}ms`
  );

  useAppStore.getState().patchQueueItem(image.id, {
    status: "completed",
    progress: 100,
    startedAt: undefined,
    statusMessage: null,
  });

  activeControllers.delete(image.id);
  return "success";
}

export async function runQueue(
  opts: { ids?: string[]; retryFailed?: boolean } = {}
): Promise<void> {
  if (active) {
    toast("info", "Already running", "Wait for the current generation to finish.");
    return;
  }

  const store = useAppStore.getState();
  let targets: ImageAsset[];
  if (opts.ids) {
    const ids = opts.ids;
    targets = store.images.filter((image) => ids.includes(image.id));
  } else if (opts.retryFailed) {
    targets = store.images.filter((image) => store.failedImageIds.includes(image.id));
  } else {
    targets = store.images;
  }
  targets = targets.filter(
    (image) =>
      Boolean(image.apiDataUrl) ||
      Boolean(image.blob) ||
      Boolean(image.dataUrl) ||
      Boolean(image.previewUrl)
  );
  if (targets.length === 0) return;

  if (!opts.retryFailed) {
    store.setFailedImageIds([]);
  }

  const activeKeyCount = activeKeys(store.apiKeys).length;
  const hasApiKeys = activeKeyCount > 0;
  updateDebug(null, null, activeKeyCount, null, null);

  if (hasApiKeys) {
    void ensureModelCache();
    warmUpProvider(store.primaryProvider);
  }

  active = true;
  stopRequested = false;
  pauseRequested = false;
  activeControllers.clear();
  preferredProvider = store.primaryProvider;
  toast(
    "info",
    "Primary provider",
    `Primary Provider: ${providerLabel(store.primaryProvider)}`
  );
  void recoveryProbeLoop();

  store.enqueue(targets.map((image) => image.id));
  store.setGenerating(true);
  store.setQueueState("running");
  store.setProgress(0);
  store.setBatchTotal(targets.length);
  store.setBatchCompleted(0);
  store.setEta(null);

  const startedAt = Date.now();
  let success = 0;
  let completed = 0;
  const failed: string[] = [];

  const processTracked = async (image: ImageAsset): Promise<void> => {
    const outcome = await processOne(image);
    completed++;
    if (outcome === "success") {
      success++;
      const index = failed.indexOf(image.id);
      if (index !== -1) failed.splice(index, 1);
    } else if (outcome === "failed" && !failed.includes(image.id)) {
      failed.push(image.id);
    }
    store.setFailedImageIds([...failed]);
    store.setBatchCompleted(Math.min(completed, targets.length));
    store.setProgress(Math.min(100, Math.round((completed / targets.length) * 100)));
    if (completed > 0) {
      const averageMs = (Date.now() - startedAt) / completed;
      store.setEta(
        Math.max(0, Math.round(((targets.length - completed) * averageMs) / 1000))
      );
    }
  };

  const CONCURRENCY = Math.max(1, Math.min(8, store.settings.maxConcurrent || MAX_CONCURRENT_GENERATIONS));

  const runConcurrent = async (items: ImageAsset[]): Promise<void> => {
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (stopRequested) return;
        while (pauseRequested) {
          if (stopRequested) return;
          store.setQueueState("paused");
          await sleep(160);
        }
        if (stopRequested) return;
        store.setQueueState("running");

        const index = nextIndex++;
        if (index >= items.length) return;
        const image = items[index];
        if (hasApiKeys) {
          try {
            await prepareImage(image);
          } catch {
            // Image preparation is retried inside generation; keep going.
          }
        }
        store.setActiveImageId(image.id);
        await processTracked(image);
      }
    };

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, items.length) },
      () => worker()
    );
    await Promise.all(workers);
  };

  const targetIds = new Set(targets.map((image) => image.id));
  await runConcurrent(targets);

  const cancelled = stopRequested;

  active = false;
  stopRequested = false;
  pauseRequested = false;
  activeControllers.clear();

  let stoppedCount = 0;
  if (cancelled) {
    const finalStore = useAppStore.getState();
    for (const id of targetIds) {
      const item = finalStore.queueItems[id];
      if (!item) continue;
      if (item.status === "cancelled") {
        stoppedCount++;
        continue;
      }
      if (item.status === "completed" || item.status === "failed") continue;
      stoppedCount++;
      finalStore.patchQueueItem(id, {
        status: "cancelled",
        error: null,
        progress: 0,
        startedAt: undefined,
        statusMessage: null,
      });
    }
  }

  store.setQueueState("idle");
  store.setGenerating(false);
  store.setActiveImageId(null);
  store.setEta(null);
  updateDebug(
    null,
    null,
    activeKeys(useAppStore.getState().apiKeys).length,
    null,
    null
  );
  if (!cancelled) {
    store.setProgress(100);
  }
  store.setFailedImageIds(failed);

  if (cancelled) {
    toast(
      "info",
      "Generation stopped",
      `${success} result${success === 1 ? "" : "s"} ready${stoppedCount > 0 ? `, ${stoppedCount} stopped` : ""}${failed.length > 0 ? `, ${failed.length} failed` : ""}.`
    );
  } else if (failed.length === 0) {
    toast(
      "success",
      "Generation complete",
      `${success} result${success === 1 ? "" : "s"} ready.`
    );
    if (success > 0) {
      setTimeout(() => useAppStore.getState().openSuccess(), 400);
    }
  } else if (success > 0) {
    toast(
      "info",
      "Partial success",
      `${success} ok, ${failed.length} failed. Use Retry for the rest.`
    );
    setTimeout(() => useAppStore.getState().openSuccess(), 400);
  } else {
    const firstFailed = useAppStore.getState().queueItems[failed[0]]?.error;
    toast(
      "error",
      "Generation incomplete",
      firstFailed ?? "No results were produced."
    );
    setTimeout(() => useAppStore.getState().openError(), 300);
  }
}

export function pauseQueue(): void {
  if (!active) return;
  pauseRequested = true;
  useAppStore.getState().setQueueState("paused");
}

export function resumeQueue(): void {
  if (!active) return;
  pauseRequested = false;
  useAppStore.getState().setQueueState("running");
}

export function stopQueue(): void {
  if (!active) return;
  stopRequested = true;
  pauseRequested = false;
  for (const controller of activeControllers.values()) {
    controller.abort();
  }
  useAppStore.getState().setQueueState("stopped");
}

export function cancelImage(imageId: string): void {
  activeControllers.get(imageId)?.abort();
}

export async function retryImage(imageId: string): Promise<void> {
  if (active) {
    toast("info", "Already running", "Wait for the current generation to finish.");
    throw new Error("A generation is already running.");
  }

  const store = useAppStore.getState();
  const image = store.images.find((item) => item.id === imageId);
  if (!image) {
    throw new Error("Image not found.");
  }

  if (activeKeys(store.apiKeys).length > 0) {
    void ensureModelCache();
    warmUpProvider(useAppStore.getState().primaryProvider);
  }

  active = true;
  stopRequested = false;
  pauseRequested = false;
  activeControllers.clear();
  preferredProvider = useAppStore.getState().primaryProvider;
  toast(
    "info",
    "Primary provider",
    `Primary Provider: ${providerLabel(preferredProvider)}`
  );
  void recoveryProbeLoop();

  store.enqueue([imageId]);
  store.setGenerating(true);
  store.setQueueState("running");
  store.setBatchTotal(0);
  store.setBatchCompleted(0);

  try {
    store.setActiveImageId(imageId);
    const outcome = await processOne(image, true);
    if (outcome !== "success") {
      const item = useAppStore.getState().queueItems[imageId];
      throw new Error(
        item?.error ??
          (outcome === "cancelled" ? "Generation stopped." : "Generation failed.")
      );
    }
  } finally {
    active = false;
    stopRequested = false;
    pauseRequested = false;
    activeControllers.clear();
    useAppStore.getState().setGenerating(false);
    useAppStore.getState().setActiveImageId(null);
    useAppStore.getState().setQueueState("idle");
    useAppStore.getState().setEta(null);
    updateDebug(
    null,
    null,
    activeKeys(useAppStore.getState().apiKeys).length,
    null,
    null
  );
  }
}
