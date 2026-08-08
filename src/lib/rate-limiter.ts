export const BACKOFF_STEPS_MS = [30_000, 60_000, 120_000, 240_000];

export function backoffDelayMs(attempt: number): number {
  const index = Math.min(
    Math.max(0, Math.floor(attempt)),
    BACKOFF_STEPS_MS.length - 1
  );
  return BACKOFF_STEPS_MS[index];
}
