export type Profile = Record<string, number>;

export function createProfiler(): {
  start(name: string): void;
  mark(name: string): void;
  end(name: string): number | null;
  result(): Profile;
} {
  const started: Record<string, number> = {};
  const times: Record<string, number> = {};
  return {
    start(name) {
      started[name] = performance.now();
    },
    mark(name) {
      times[name] = performance.now();
    },
    end(name) {
      const startedAt = started[name];
      if (startedAt == null) return null;
      const ms = performance.now() - startedAt;
      times[name] = ms;
      delete started[name];
      return ms;
    },
    result() {
      return { ...times };
    },
  };
}

export function logProfile(label: string, profile: Profile): void {
  const entries = Object.entries(profile)
    .filter(([, ms]) => ms >= 1)
    .sort(([, a], [, b]) => b - a);
  const total = entries.reduce((sum, [, ms]) => sum + ms, 0);
  const detail = entries
    .map(([name, ms]) => `${name}=${ms.toFixed(0)}ms`)
    .join(" ");
  console.log(
    `[Perf] ${label} — ${detail || "under 1ms"}${entries.length ? ` | total=${total.toFixed(0)}ms` : ""}`
  );
}
