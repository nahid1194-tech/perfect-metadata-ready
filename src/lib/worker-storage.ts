import {
  createJSONStorage,
  type PersistStorage,
  type StateStorage,
} from "zustand/middleware";

const memoryStore = new Map<string, string>();

const memoryStateStorage: StateStorage = {
  getItem: (name) => memoryStore.get(name) ?? null,
  setItem: (name, value) => {
    memoryStore.set(name, value);
  },
  removeItem: (name) => {
    memoryStore.delete(name);
  },
};

export function hasLocalStorage(): boolean {
  try {
    return (
      typeof globalThis !== "undefined" &&
      "localStorage" in globalThis &&
      globalThis.localStorage !== null
    );
  } catch {
    return false;
  }
}

/**
 * zustand persist storage that works on the main thread (localStorage) and
 * inside a Web Worker (in-memory fallback, since localStorage is not exposed
 * to workers). The worker's store is seeded from the main thread instead.
 */
export function createWorkerSafeStorage(): PersistStorage<unknown> {
  if (hasLocalStorage()) {
    return createJSONStorage(() => globalThis.localStorage) as PersistStorage<unknown>;
  }
  return createJSONStorage(() => memoryStateStorage) as PersistStorage<unknown>;
}
