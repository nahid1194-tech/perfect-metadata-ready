import type { ApiProvider, GenerationSpeed } from "@/lib/types";
import { useAppStore } from "@/store/use-app-store";

const FIXED_DELAY_MS: Record<Exclude<GenerationSpeed, "smart">, number> = {
  fast: 200,
  balanced: 1000,
  slow: 3000,
};

const SMART_START_MS = 2000;
const SMART_MIN_MS = 1000;
const SMART_BACKOFF_MIN_MS = 5000;
const SMART_BACKOFF_MAX_MS = 10_000;
const SMART_STEP_MS = 250;
const SMART_SUCCESSES_BEFORE_REDUCE = 3;

const PROVIDERS: ApiProvider[] = ["gemini", "openai", "mistral"];

let cachedMode: GenerationSpeed | null = null;

const smartState: Record<ApiProvider, { delayMs: number; streak: number }> = {
  gemini: { delayMs: SMART_START_MS, streak: 0 },
  openai: { delayMs: SMART_START_MS, streak: 0 },
  mistral: { delayMs: SMART_START_MS, streak: 0 },
};

function activeMode(): GenerationSpeed {
  const mode = useAppStore.getState().settings.generationSpeed ?? "smart";
  if (mode !== cachedMode) {
    cachedMode = mode;
    for (const provider of PROVIDERS) {
      smartState[provider] = { delayMs: SMART_START_MS, streak: 0 };
    }
  }
  return mode;
}

export function currentDelayMs(provider: ApiProvider): number {
  const mode = activeMode();
  if (mode === "smart") return smartState[provider].delayMs;
  return FIXED_DELAY_MS[mode];
}

function sleepCancellable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForProviderSlot(
  provider: ApiProvider,
  signal?: AbortSignal
): Promise<void> {
  const delayMs = currentDelayMs(provider);
  if (delayMs <= 0) return;
  await sleepCancellable(delayMs, signal);
}

export function noteProviderSuccess(provider: ApiProvider): void {
  if (activeMode() !== "smart") return;
  const state = smartState[provider];
  state.streak++;
  if (state.streak >= SMART_SUCCESSES_BEFORE_REDUCE) {
    state.streak = 0;
    state.delayMs = Math.max(SMART_MIN_MS, state.delayMs - SMART_STEP_MS);
    console.log(
      `[RateLimiter] ${provider} steady, reducing delay to ${state.delayMs}ms`
    );
  }
}

export function noteProviderRateLimit(provider: ApiProvider): void {
  if (activeMode() !== "smart") return;
  const state = smartState[provider];
  state.streak = 0;
  state.delayMs =
    SMART_BACKOFF_MIN_MS +
    Math.floor(Math.random() * (SMART_BACKOFF_MAX_MS - SMART_BACKOFF_MIN_MS));
  console.log(
    `[RateLimiter] ${provider} rate-limited, backing off to ${state.delayMs}ms`
  );
}

export function resetRateLimiter(): void {
  cachedMode = null;
  for (const provider of PROVIDERS) {
    smartState[provider] = { delayMs: SMART_START_MS, streak: 0 };
  }
}
