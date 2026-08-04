import type { ApiProvider, GenerationSpeed } from "@/lib/types";
import { useAppStore } from "@/store/use-app-store";

const REQUEST_DELAY_RANGE_MS: Record<GenerationSpeed, [number, number]> = {
  "super-fast": [0, 0],
  fast: [300, 600],
  normal: [2000, 3000],
};

const RETRY_DELAY_MS: Record<GenerationSpeed, number> = {
  "super-fast": 300,
  fast: 500,
  normal: 2000,
};

const KEY_ROTATION_DELAY_MS: Record<GenerationSpeed, number> = {
  "super-fast": 0,
  fast: 150,
  normal: 400,
};

const PROVIDER_SWITCH_DELAY_MS: Record<GenerationSpeed, number> = {
  "super-fast": 0,
  fast: 250,
  normal: 500,
};

const QUEUE_DELAY_MS: Record<GenerationSpeed, number> = {
  "super-fast": 0,
  fast: 150,
  normal: 400,
};

const CONCURRENCY: Record<GenerationSpeed, number> = {
  "super-fast": 0,
  fast: 3,
  normal: 1,
};

const SPEEDS: GenerationSpeed[] = ["super-fast", "fast", "normal"];

export function normalizeSpeed(value: unknown): GenerationSpeed {
  return SPEEDS.includes(value as GenerationSpeed) ? (value as GenerationSpeed) : "normal";
}

export function currentSpeed(): GenerationSpeed {
  return normalizeSpeed(useAppStore.getState().settings.generationSpeed);
}

function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function superFastConcurrency(activeKeyCount: number): number {
  const base = Math.max(1, activeKeyCount * 2);
  return Math.min(8, base);
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
  const speed = currentSpeed();
  if (speed === "super-fast") {
    const keys = useAppStore.getState().apiKeys;
    const active = keys.filter((key) => key.enabled).length;
    return superFastConcurrency(active);
  }
  return CONCURRENCY[speed];
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
