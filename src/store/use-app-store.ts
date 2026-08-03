import { create } from "zustand";
import { persist } from "zustand/middleware";

import { FALLBACK_MODELS } from "@/lib/model-catalog";
import type {
  ApiKeyEntry,
  ApiProvider,
  GenerationResult,
  GenerationSettings,
  ImageAsset,
  QueueItem,
  QueueState,
} from "@/lib/types";

type Theme = "light" | "dark";

export const DEFAULT_SETTINGS: GenerationSettings = {
  platform: "adobe",
  titleLength: 60,
  descriptionLength: 300,
  keywordCount: 20,
  prefix: "",
  suffix: "",
  negativeTitleWords: "",
  negativeKeywords: "",
  enablePrefix: false,
  enableSuffix: false,
  enableNegativeTitleWords: false,
  enableNegativeKeywords: false,
};

type AppState = {
  theme: Theme;
  apiKeys: ApiKeyEntry[];
  primaryProvider: ApiProvider;
  providerModels: Record<ApiProvider, string[]>;
  providerModelsFetchedAt: Record<ApiProvider, number | null>;
  images: ImageAsset[];
  selectedIds: string[];
  results: GenerationResult[];
  generating: boolean;
  progress: number;
  queueItems: Record<string, QueueItem>;
  queueState: QueueState;
  batchTotal: number;
  batchCompleted: number;
  etaSeconds: number | null;
  successOpen: boolean;
  errorOpen: boolean;
  failedImageIds: string[];
  settings: GenerationSettings;
  setTheme: (theme: Theme) => void;
  setApiKeys: (keys: ApiKeyEntry[]) => void;
  addApiKey: (entry: ApiKeyEntry) => void;
  updateApiKey: (id: string, patch: Partial<Omit<ApiKeyEntry, "id">>) => void;
  removeApiKey: (id: string) => void;
  setPrimaryProvider: (provider: ApiProvider) => void;
  setProviderModels: (
    provider: ApiProvider,
    models: string[],
    fetchedAt: number
  ) => void;
  setSettings: (patch: Partial<GenerationSettings>) => void;
  addImages: (images: ImageAsset[]) => void;
  updateImage: (id: string, patch: Partial<ImageAsset>) => void;
  removeImage: (id: string) => void;
  clearImages: () => void;
  toggleSelected: (id: string) => void;
  setSelected: (ids: string[]) => void;
  clearSelected: () => void;
  setGenerating: (generating: boolean) => void;
  setProgress: (progress: number) => void;
  patchQueueItem: (id: string, patch: Partial<QueueItem>) => void;
  enqueue: (ids: string[]) => void;
  removeQueueItem: (id: string) => void;
  resetQueue: () => void;
  setQueueState: (queueState: QueueState) => void;
  setBatchTotal: (batchTotal: number) => void;
  setBatchCompleted: (batchCompleted: number) => void;
  setEta: (etaSeconds: number | null) => void;
  openSuccess: () => void;
  closeSuccess: () => void;
  openError: () => void;
  closeError: () => void;
  setFailedImageIds: (ids: string[]) => void;
  addResult: (result: GenerationResult) => void;
  updateResult: (id: string, updater: (result: GenerationResult) => GenerationResult) => void;
  removeResult: (id: string) => void;
  clearResults: () => void;
  resultCache: Record<string, GenerationResult>;
  setResultCache: (key: string, result: GenerationResult) => void;
  debugStatus: {
    activeProvider: ApiProvider | null;
    activeKeyIndex: number | null;
    activeKeyCount: number;
    activeModel: string | null;
    activeKeyMasked: string | null;
    remainingKeys: number | null;
    fallbackActive: boolean;
  };
  setDebugStatus: (
    patch: Partial<{
      activeProvider: ApiProvider | null;
      activeKeyIndex: number | null;
      activeKeyCount: number;
      activeModel: string | null;
      activeKeyMasked: string | null;
      remainingKeys: number | null;
      fallbackActive: boolean;
    }>
  ) => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: "light",
      apiKeys: [],
      primaryProvider: "gemini",
      providerModels: { ...FALLBACK_MODELS },
      providerModelsFetchedAt: {
        gemini: null,
        openai: null,
        mistral: null,
      },
      images: [],
      selectedIds: [],
      results: [],
      generating: false,
      progress: 0,
      queueItems: {},
      queueState: "idle",
      batchTotal: 0,
      batchCompleted: 0,
      etaSeconds: null,
      successOpen: false,
      errorOpen: false,
      failedImageIds: [],
      settings: DEFAULT_SETTINGS,
      setTheme: (theme) => set({ theme }),
      setApiKeys: (apiKeys) => set({ apiKeys }),
      addApiKey: (entry) =>
        set((state) => ({ apiKeys: [...state.apiKeys, entry] })),
      updateApiKey: (id, patch) =>
        set((state) => ({
          apiKeys: state.apiKeys.map((entry) =>
            entry.id === id ? { ...entry, ...patch } : entry
          ),
        })),
      removeApiKey: (id) =>
        set((state) => ({
          apiKeys: state.apiKeys.filter((entry) => entry.id !== id),
        })),
      setPrimaryProvider: (primaryProvider) => set({ primaryProvider }),
      setProviderModels: (provider, models, fetchedAt) =>
        set((state) => ({
          providerModels: { ...state.providerModels, [provider]: models },
          providerModelsFetchedAt: {
            ...state.providerModelsFetchedAt,
            [provider]: fetchedAt,
          },
        })),
      setSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
      addImages: (images) =>
        set((state) => ({ images: [...state.images, ...images] })),
      updateImage: (id, patch) =>
        set((state) => ({
          images: state.images.map((img) =>
            img.id === id ? { ...img, ...patch } : img
          ),
        })),
      removeImage: (id) =>
        set((state) => {
          const queueItems = { ...state.queueItems };
          delete queueItems[id];
          return {
            images: state.images.filter((img) => img.id !== id),
            selectedIds: state.selectedIds.filter((selected) => selected !== id),
            results: state.results.filter((result) => result.imageId !== id),
            queueItems,
          };
        }),
      clearImages: () =>
        set({ images: [], selectedIds: [], queueItems: {}, queueState: "idle" }),
      toggleSelected: (id) =>
        set((state) => ({
          selectedIds: state.selectedIds.includes(id)
            ? state.selectedIds.filter((selected) => selected !== id)
            : [...state.selectedIds, id],
        })),
      setSelected: (ids) => set({ selectedIds: ids }),
      clearSelected: () => set({ selectedIds: [] }),
      setGenerating: (generating) => set({ generating }),
      setProgress: (progress) => set({ progress }),
      patchQueueItem: (id, patch) =>
        set((state) => {
          const current = state.queueItems[id] ?? {
            imageId: id,
            status: "waiting" as const,
            progress: 0,
            error: null,
          };
          return {
            queueItems: {
              ...state.queueItems,
              [id]: { ...current, ...patch },
            },
          };
        }),
      enqueue: (ids) =>
        set((state) => {
          const queueItems = { ...state.queueItems };
          for (const id of ids) {
            if (!queueItems[id]) {
              queueItems[id] = { imageId: id, status: "waiting", progress: 0, error: null };
            }
          }
          return { queueItems };
        }),
      removeQueueItem: (id) =>
        set((state) => {
          const queueItems = { ...state.queueItems };
          delete queueItems[id];
          return { queueItems };
        }),
      resetQueue: () => set({ queueItems: {}, queueState: "idle" }),
      setQueueState: (queueState) => set({ queueState }),
      setBatchTotal: (batchTotal) => set({ batchTotal }),
      setBatchCompleted: (batchCompleted) => set({ batchCompleted }),
      setEta: (etaSeconds) => set({ etaSeconds }),
      openSuccess: () => set({ successOpen: true }),
      closeSuccess: () => set({ successOpen: false }),
      openError: () => set({ errorOpen: true }),
      closeError: () => set({ errorOpen: false }),
      setFailedImageIds: (failedImageIds) => set({ failedImageIds }),
      addResult: (result) => set((state) => ({ results: [result, ...state.results] })),
      updateResult: (id, updater) =>
        set((state) => ({
          results: state.results.map((result) =>
            result.id === id ? updater(result) : result
          ),
        })),
      removeResult: (id) =>
        set((state) => ({ results: state.results.filter((r) => r.id !== id) })),
      clearResults: () => set({ results: [] }),
      resultCache: {},
      setResultCache: (key, result) =>
        set((state) => {
          const next = { ...state.resultCache, [key]: result };
          const keys = Object.keys(next);
          const CACHE_LIMIT = 300;
          if (keys.length > CACHE_LIMIT) {
            const oldest = keys
              .slice()
              .sort((a, b) => (next[a].createdAt < next[b].createdAt ? -1 : 1))
              .slice(0, keys.length - CACHE_LIMIT);
            for (const staleKey of oldest) delete next[staleKey];
          }
          return { resultCache: next };
        }),
      debugStatus: {
        activeProvider: null,
        activeKeyIndex: null,
        activeKeyCount: 0,
        activeModel: null,
        activeKeyMasked: null,
        remainingKeys: null,
        fallbackActive: false,
      },
      setDebugStatus: (patch) =>
        set((state) => ({ debugStatus: { ...state.debugStatus, ...patch } })),
    }),
    {
      name: "app-storage",
      partialize: (state) => ({
        theme: state.theme,
        apiKeys: state.apiKeys,
        primaryProvider: state.primaryProvider,
        providerModels: state.providerModels,
        providerModelsFetchedAt: state.providerModelsFetchedAt,
        settings: state.settings,
        resultCache: state.resultCache,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as (Partial<AppState> & {
          apiKey?: string;
        }) | undefined;
        const validProviders: ApiProvider[] = ["gemini", "openai", "mistral"];
        const persistedPlatform = persisted?.settings?.platform;
        const validPlatform: "adobe" | "shutterstock" =
          persistedPlatform === "shutterstock" ? "shutterstock" : "adobe";
        const merged: AppState = {
          ...currentState,
          ...persisted,
          settings: {
            ...DEFAULT_SETTINGS,
            ...persisted?.settings,
            platform: validPlatform,
          },
        };
        const legacyKey = persisted?.apiKey?.trim() ?? "";
        if (legacyKey && !Array.isArray(merged.apiKeys)) {
          merged.apiKeys = [
            {
              id: crypto.randomUUID(),
              provider: "gemini",
              key: legacyKey,
              enabled: true,
            },
          ];
        }
        if (Array.isArray(merged.apiKeys)) {
          merged.apiKeys = merged.apiKeys.map(
            (entry: ApiKeyEntry): ApiKeyEntry => ({
              id: entry.id,
              provider: validProviders.includes(entry.provider)
                ? entry.provider
                : "gemini",
              key: entry.key,
              enabled: entry.enabled ?? true,
            })
          );
        }
        if (
          !merged.providerModels ||
          typeof merged.providerModels !== "object"
        ) {
          merged.providerModels = { ...FALLBACK_MODELS };
        }
        for (const provider of validProviders) {
          const list = merged.providerModels[provider];
          if (!Array.isArray(list) || list.length === 0) {
            merged.providerModels[provider] = FALLBACK_MODELS[provider];
          }
        }
        if (
          !merged.providerModelsFetchedAt ||
          typeof merged.providerModelsFetchedAt !== "object"
        ) {
          merged.providerModelsFetchedAt = {
            gemini: null,
            openai: null,
            mistral: null,
          };
        }
        for (const provider of validProviders) {
          if (typeof merged.providerModelsFetchedAt[provider] !== "number") {
            merged.providerModelsFetchedAt[provider] = null;
          }
        }
        if (!validProviders.includes(merged.primaryProvider)) {
          merged.primaryProvider = "gemini";
        }
        if (Array.isArray(merged.results)) {
          merged.results = merged.results.map((result: GenerationResult) => ({
            id: result.id,
            imageId: result.imageId,
            createdAt: result.createdAt,
            imageName: result.imageName,
            metadata: result.metadata,
          }));
        }
        if (
          !merged.resultCache ||
          typeof merged.resultCache !== "object" ||
          Array.isArray(merged.resultCache)
        ) {
          merged.resultCache = {};
        }
        return merged;
      },
    }
  )
);
