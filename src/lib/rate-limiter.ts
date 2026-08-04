import type { ApiProvider, GenerationSpeed } from "@/lib/types";
import { useAppStore } from "@/store/use-app-store";

const REQUEST_DELAY_RANGE_MS: Record<GenerationSpeed, [number, number]> = {
  fast: [500, 1000],
  normal: [2000, 3000],
  slow: [5000, 8000],
};

const RETRY_DELAY_MS: Record<GenerationSpeed, number> = {
  fast: 500,
  normal: 2000,
  slow: 5000,
};

const KEY_ROTATION_DELAY_MS: Record<GenerationSpeed, number> = {
  fast: 0,
  normal: 400,
  slow: 1500,
};

const PROVIDER_SWITCH_DELAY_MS: Record<GenerationSpeed, number> = {
  fast: 0,
  normal: 500,
  slow: 2000,
};

const QUEUE_DELAY_MS: Record<GenerationSpeed, number> = {
  fast: 0,
  normal: 400,
  slow: 1500,
};

const CONCURRENCY: Record<GenerationSpeed, number> = {
  fast: 2,
  normal: 1,
  slow: 1,
};

export function currentSpeed(): GenerationSpeed {
  return useAppStore.getState().settings.generationSpeed ?? "normal";
}

function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function requestDelayMs(): number {
  const [min, max] = REQUEST_DELAY_RANGE_MS[currentSpeed()];
  return randomBetween(min, max);
}

export function retryDelayMs(): number {
  return RETRY_DELAY_MS[currentSpeed()];
}

export function keyRotationDelayMs(): number {
  return KEY_ROTATION_DELAY_MS[currentSpeed()];
}

export function providerSwitchDelayMs(): number {
  return PROVIDER_SWITCH_DELAY_MS[currentSpeed()];
}

export function queueDelayMs(): number {
  return QUEUE_DELAY_MS[currentSpeed()];
}

export function currentConcurrency(): number {
  return CONCURRENCY[currentSpeed()];
}

function sleepCancellable(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
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
  const delayMs = requestDelayMs();
  if (delayMs > 0) {
    console.log(
      `[RateLimiter] ${provider} waiting ${delayMs}ms (${currentSpeed()}) before request`
    );
  }
  await sleepCancellable(delayMs, signal);
}
