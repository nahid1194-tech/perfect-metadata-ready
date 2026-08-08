/**
 * Polite upstream request management.
 *
 * These helpers never bypass rate limits — they make the client *respect*
 * them better: cap concurrent requests and coalesce identical in-flight
 * requests so the same query never hits the source twice at once.
 */

/** A simple concurrency limiter (semaphore). */
export function createSemaphore(max: number) {
  let active = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (active < max) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    active += 1;
  }

  function release(): void {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  }

  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/**
 * Coalesce concurrent identical requests: if the same key is already being
 * fetched, waiters share the in-flight promise instead of firing again.
 */
export function dedupeInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fn().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

const inflight = new Map<string, Promise<unknown>>();

export function clearInflight(): void {
  inflight.clear();
}
