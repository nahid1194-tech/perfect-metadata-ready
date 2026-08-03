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
  GEMINI_MODELS,
  OPENAI_MODELS,
  friendlyApiError,
  generateLocal,
  generateWithApi,
  generateWithOpenAI,
  isInvalidImageError,
  isKeyFailure,
  isModelBusy,
  isNetworkError,
  isRateLimited,
  NoActiveKeyError,
  RateLimitedError,
  rateLimitDelayMs,
} from "@/lib/generate";
import type {
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
let currentController: AbortController | null = null;
let currentImageId: string | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RATE_LIMIT_RETRY_CAP = 12;
const IMAGE_DELAY_MIN_MS = 400;
const IMAGE_DELAY_MAX_MS = 800;

function updateDebug(
  activeProvider: ApiProvider | null,
  activeKeyIndex: number | null,
  activeKeyCount: number,
  activeModel: string | null,
  activeKeyMasked: string | null
): void {
  useAppStore.getState().setDebugStatus({
    activeProvider,
    activeKeyIndex,
    activeKeyCount,
    activeModel,
    activeKeyMasked,
  });
}

function providerLabel(provider: ApiProvider): string {
  return provider === "gemini" ? "Gemini" : "OpenAI";
}

let lastProviderSwitchToastAt = 0;
let lastOpenAiKeySwitchToastAt = 0;

function notifyProviderSwitch(from: ApiProvider, to: ApiProvider): void {
  const now = Date.now();
  if (now - lastProviderSwitchToastAt < 15000) return;
  lastProviderSwitchToastAt = now;
  const message =
    to === "openai"
      ? "Gemini quota reached. Switched to OpenAI automatically."
      : `All ${providerLabel(from)} API keys exhausted. Switched to ${providerLabel(to)} automatically.`;
  console.log(`[Queue] ${message}`);
  toast("info", "Provider switched", message);
}

function notifyOpenAiKeySwitch(nextKeyIndex: number): void {
  if (nextKeyIndex === 0) return;
  const now = Date.now();
  if (now - lastOpenAiKeySwitchToastAt < 10000) return;
  lastOpenAiKeySwitchToastAt = now;
  const message = `Switched to OpenAI API Key #${nextKeyIndex + 1}.`;
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

async function sleepBetweenImages(): Promise<void> {
  const delayMs =
    IMAGE_DELAY_MIN_MS + Math.random() * (IMAGE_DELAY_MAX_MS - IMAGE_DELAY_MIN_MS);
  const chunk = 120;
  let elapsed = 0;
  while (elapsed < delayMs) {
    if (stopRequested) return;
    while (pauseRequested) {
      if (stopRequested) return;
      useAppStore.getState().setQueueState("paused");
      await sleep(160);
    }
    useAppStore.getState().setQueueState("running");
    await sleep(chunk);
    elapsed += chunk;
  }
}

async function waitForRateLimit(
  image: ImageAsset,
  error: RateLimitedError,
  controller: AbortController
): Promise<void> {
  const seconds = Math.max(1, Math.round(error.delayMs / 1000));
  const message = `API key rate-limited. Waiting ${seconds} seconds before retrying...`;
  console.log(`[Gemini] All active API keys rate-limited, pausing for ${seconds}s`);
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
  useAppStore.getState().setQueueState("paused");
  toast("info", "Rate limit reached", message);
  await sleepCancellable(error.delayMs, controller.signal);
  useAppStore.getState().patchQueueItem(image.id, {
    status: "analyzing",
    statusMessage: null,
  });
  useAppStore.getState().setQueueState("running");
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

  const models =
    provider === "gemini"
      ? [store.model, ...GEMINI_MODELS.filter((model) => model !== store.model)]
      : [
          store.openaiModel,
          ...OPENAI_MODELS.filter((model) => model !== store.openaiModel),
        ];

  let sawRateLimit = false;
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

    console.log(
      `[${provider}] Using API key ${keyIndex + 1}/${keys.length} (${maskKey(key.key)})`
    );
    updateDebug(provider, keyIndex, keys.length, null, maskKey(key.key));

    for (const model of models) {
      console.log(`[${provider}] Using model ${model}`);
      updateDebug(provider, keyIndex, keys.length, model, maskKey(key.key));
      let networkRetries = 0;
      for (;;) {
        try {
          return await (provider === "gemini"
            ? generateWithApi(image, key.key, model, settings, signal)
            : generateWithOpenAI(image, key.key, model, settings, signal));
        } catch (error) {
          if (signal.aborted) throw error;
          if (isRateLimited(error)) {
            const until = Date.now() + rateLimitDelayMs(error);
            markKeyRateLimited(key.id, until);
            sawRateLimit = true;
            waitUntil = Math.min(waitUntil, until);
            console.log(
              `[${provider}] API key ${maskKey(key.key)} rate-limited, switching to the next active key`
            );
            if (provider === "openai") notifyOpenAiKeySwitch(keyIndex + 1);
            continue keyLoop;
          }
          if (isNetworkError(error) && networkRetries < 2) {
            networkRetries++;
            await sleep(600);
            continue;
          }
          if (isInvalidImageError(error)) throw error;
          if (isModelBusy(error)) {
            nonRateLimitError ??= error;
            break;
          }
          if (isKeyFailure(error)) {
            nonRateLimitError ??= error;
            if (provider === "openai") notifyOpenAiKeySwitch(keyIndex + 1);
            continue keyLoop;
          }
          nonRateLimitError ??= error;
          throw error;
        }
      }
    }
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
    isModelBusy(error) ||
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
  const geminiKeys = activeKeys(store.apiKeys, "gemini");
  const openaiKeys = activeKeys(store.apiKeys, "openai");
  if (geminiKeys.length === 0 && openaiKeys.length === 0) {
    throw new NoActiveKeyError();
  }

  let sawRateLimit = false;
  let lastError: unknown = null;
  let geminiFailed = false;

  if (geminiKeys.length > 0) {
    try {
      return await generateWithKeys("gemini", image, settings, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      sawRateLimit ||= isRetryableFailure(error);
      lastError = error;
      geminiFailed = true;
    }
  }

  if (openaiKeys.length > 0) {
    if (geminiFailed) notifyProviderSwitch("gemini", "openai");
    try {
      return await generateWithKeys("openai", image, settings, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      sawRateLimit ||= isRetryableFailure(error);
      lastError = error;
    }
  }

  if (sawRateLimit) {
    throw new RateLimitedError(Math.max(1, retryDelayFor(lastError)));
  }
  throw lastError ?? new NoActiveKeyError();
}

async function processOne(image: ImageAsset, force = false): Promise<boolean> {
  const store = useAppStore.getState();
  if (!store.images.some((item) => item.id === image.id)) {
    store.removeQueueItem(image.id);
    return false;
  }

  const controller = new AbortController();
  currentController = controller;
  currentImageId = image.id;

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
  }, 140);

  let result: GenerationResult;
  try {
    const { settings } = useAppStore.getState();
    if (activeKeys(useAppStore.getState().apiKeys).length === 0) {
      result = generateLocal(image, settings);
    } else {
      const cacheKey = await resultCacheKey(image, settings);
      const cached = useAppStore.getState().resultCache[cacheKey];
      if (!force && cached) {
        result = rebaseCachedResult(cached, image);
      } else {
        let rateLimitRetries = 0;
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
            if (rateLimitRetries >= RATE_LIMIT_RETRY_CAP) throw error;
            rateLimitRetries++;
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
    const message = aborted ? "Cancelled" : friendlyApiError(error);
    useAppStore.getState().patchQueueItem(image.id, {
      status: "failed",
      error: message,
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
    if (currentController === controller) currentController = null;
    return false;
  }

  clearInterval(ticker);
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

  useAppStore.getState().patchQueueItem(image.id, {
    status: "completed",
    progress: 100,
    startedAt: undefined,
    statusMessage: null,
  });

  if (currentController === controller) currentController = null;
  return true;
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
  targets = targets.filter((image) => Boolean(image.dataUrl));
  if (targets.length === 0) return;

  if (!opts.retryFailed) {
    store.setFailedImageIds([]);
  }

  const activeKeyCount = activeKeys(store.apiKeys).length;
  const hasApiKeys = activeKeyCount > 0;
  updateDebug(null, null, activeKeyCount, null, null);

  active = true;
  stopRequested = false;
  pauseRequested = false;
  currentController = null;
  currentImageId = null;

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

  for (let index = 0; index < targets.length; index++) {
    if (stopRequested) break;
    while (pauseRequested) {
      if (stopRequested) break;
      store.setQueueState("paused");
      await sleep(160);
    }
    if (stopRequested) break;
    store.setQueueState("running");

    const image = targets[index];
    const ok = await processOne(image);
    completed++;
    if (ok) success++;
    else failed.push(image.id);

    store.setBatchCompleted(completed);
    store.setProgress(Math.round((completed / targets.length) * 100));
    if (completed > 0) {
      const averageMs = (Date.now() - startedAt) / completed;
      store.setEta(
        Math.max(0, Math.round(((targets.length - completed) * averageMs) / 1000))
      );
    }

    if (index < targets.length - 1 && hasApiKeys) {
      await sleepBetweenImages();
    }
  }

  const cancelled = stopRequested;

  active = false;
  stopRequested = false;
  pauseRequested = false;
  currentController = null;
  currentImageId = null;

  store.setQueueState("idle");
  store.setGenerating(false);
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
      `${success} result${success === 1 ? "" : "s"} ready, ${failed.length} failed.`
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
  currentController?.abort();
  useAppStore.getState().setQueueState("stopped");
}

export function cancelImage(imageId: string): void {
  if (currentImageId !== imageId || !currentController) return;
  currentController.abort();
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

  active = true;
  stopRequested = false;
  pauseRequested = false;
  currentController = null;
  currentImageId = null;

  store.enqueue([imageId]);
  store.setGenerating(true);
  store.setQueueState("running");
  store.setBatchTotal(0);
  store.setBatchCompleted(0);

  try {
    const ok = await processOne(image, true);
    if (!ok) {
      const item = useAppStore.getState().queueItems[imageId];
      throw new Error(item?.error ?? "Generation failed.");
    }
  } finally {
    active = false;
    stopRequested = false;
    pauseRequested = false;
    currentController = null;
    currentImageId = null;
    useAppStore.getState().setGenerating(false);
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
