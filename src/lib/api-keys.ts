import type { ApiKeyEntry, ApiProvider } from "@/lib/types";

export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}********${trimmed.slice(-4)}`;
}

export function activeKeys(
  keys: ApiKeyEntry[],
  provider?: ApiProvider
): ApiKeyEntry[] {
  return keys.filter(
    (entry) =>
      (provider === undefined || entry.provider === provider) &&
      entry.enabled &&
      entry.key.trim().length > 0
  );
}

type KeyCooldown = {
  keyId: string;
  until: number;
};

let rotationCursor = 0;
let cooldowns: KeyCooldown[] = [];

export function rotateKeys(keys: ApiKeyEntry[]): ApiKeyEntry[] {
  if (keys.length === 0) return [];
  const start = rotationCursor % keys.length;
  rotationCursor = (rotationCursor + 1) % keys.length;
  const ordered: ApiKeyEntry[] = [];
  for (let i = 0; i < keys.length; i++) {
    ordered.push(keys[(start + i) % keys.length]);
  }
  return ordered;
}

export function markKeyRateLimited(keyId: string, until: number): void {
  cooldowns = cooldowns.filter((entry) => entry.keyId !== keyId);
  cooldowns.push({ keyId, until });
}

export function clearKeyCooldown(keyId: string): void {
  cooldowns = cooldowns.filter((entry) => entry.keyId !== keyId);
}

export function keyCooldownUntil(keyId: string, now: number): number | null {
  const entry = cooldowns.find((item) => item.keyId === keyId);
  if (!entry) return null;
  if (entry.until <= now) return null;
  return entry.until;
}

export function pruneKeyCooldowns(now: number): void {
  cooldowns = cooldowns.filter((entry) => entry.until > now);
}
