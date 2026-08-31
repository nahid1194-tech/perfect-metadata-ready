import { create } from "zustand";
import { persist } from "zustand/middleware";

import { revokeAssetUrls } from "@/lib/object-url";
import { createWorkerSafeStorage } from "@/lib/worker-storage";
import { FALLBACK_MODELS } from "@/lib/model-catalog";
import { normalizeEditorialAssessment } from "@/lib/editorial";
import type {
  ApiKeyEntry,
  ApiProvider,
  DebugStatus,
  GenerationResult,
  GenerationSettings,
  GitPushStatus,
  GitSyncConfig,
  ImageAsset,
  QueueItem,
  QueueState,
  WorkerSnapshot,
} from "@/lib/types";

type Theme = "light" | "dark";

export const DEFAULT_SETTINGS: GenerationSettings = {
  platform: "adobe",
  titleLength: 60,
  descriptionLength: 300,
  keywordCount: 49,
  prefix: "",
  suffix: "",
  negativeTitleWords: "",
  negativeKeywords: "",
  enablePrefix: false,
  enableSuffix: false,
  enableNegativeTitleWords: false,
  enableNegativeKeywords: false,
  maxConcurrent: 3,
};

export const DEFAULT_GIT_CONFIG: GitSyncConfig = {
  repoUrl: "",
  branch: "main",
  token: "",
  commitMessage: "Auto-update: Generated SEO metadata for images",
  outputDir: "output",
};

const DEFAULT_GIT_PUSH_STATUS: GitPushStatus = {
  state: "idle",
  message: null,
  commitHash: null,
  branch: null,
  lastPushedAt: null,
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
  activeImageId: string | null;
  setActiveImageId: (activeImageId: string | null) => void;
  autoScroll: boolean;
  setAutoScroll: (autoScroll: boolean) => void;
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
  clearAll: () => void;
  resultCache: Record<string, GenerationResult>;
  setResultCache: (key: string, result: GenerationResult) => void;
  debugStatus: DebugStatus;
  setDebugStatus: (patch: Partial<DebugStatus>) => void;
  applyWorkerSnapshot: (patch: Partial<Omit<WorkerSnapshot, "jobId">>) => void;
  gitConfig: GitSyncConfig;
  setGitConfig: (patch: Partial<GitSyncConfig>) => void;
  gitPushStatus: GitPushStatus;
  setGitPushStatus: (patch: Partial<GitPushStatus>) => void;
  keyHealthCheckedAt: number | null;
  setKeyHealthCheckedAt: (timestamp: number | null) => void;
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
      activeImageId: null,
      autoScroll: true,
      queueItems: {},
      queueState: "idle",
      batchTotal: 0,
      batchCompleted: 0,
      etaSeconds: null,
      successOpen: false,
      errorOpen: false,
      failedImageIds: [],
      settings: DEFAULT_SETTINGS,
      gitConfig: DEFAULT_GIT_CONFIG,
      gitPushStatus: DEFAULT_GIT_PUSH_STATUS,
      keyHealthCheckedAt: null,
      setKeyHealthCheckedAt: (timestamp) => set({ keyHealthCheckedAt: timestamp }),
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
      setGitConfig: (patch) =>
        set((state) => ({ gitConfig: { ...state.gitConfig, ...patch } })),
      setGitPushStatus: (patch) =>
        set((state) => ({ gitPushStatus: { ...state.gitPushStatus, ...patch } })),
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
          const target = state.images.find((img) => img.id === id);
          if (target) revokeAssetUrls(target);
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
        set((state) => {
          for (const image of state.images) revokeAssetUrls(image);
          return { images: [], selectedIds: [], queueItems: {}, queueState: "idle" };
        }),
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
      setActiveImageId: (activeImageId) => set({ activeImageId }),
      setAutoScroll: (autoScroll) => set({ autoScroll }),
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
      clearResults: () =>
        set((state) => {
          const queueItems = { ...state.queueItems };
          for (const [id, item] of Object.entries(queueItems)) {
            if (item.status === "completed") delete queueItems[id];
          }
          return { results: [], queueItems };
        }),
      clearAll: () =>
        set((state) => {
          for (const image of state.images) revokeAssetUrls(image);
          return {
            images: [],
            selectedIds: [],
            results: [],
            generating: false,
            progress: 0,
            activeImageId: null,
            queueItems: {},
            queueState: "idle",
            batchTotal: 0,
            batchCompleted: 0,
            etaSeconds: null,
            successOpen: false,
            errorOpen: false,
            failedImageIds: [],
            resultCache: {},
          };
        }),
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
      applyWorkerSnapshot: (patch) =>
        set((state) => ({
          ...(patch.results !== undefined ? { results: patch.results } : {}),
          ...(patch.queueItems !== undefined
            ? { queueItems: patch.queueItems }
            : {}),
          ...(patch.batchTotal !== undefined
            ? { batchTotal: patch.batchTotal }
            : {}),
          ...(patch.batchCompleted !== undefined
            ? { batchCompleted: patch.batchCompleted }
            : {}),
          ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
          ...(patch.generating !== undefined
            ? { generating: patch.generating }
            : {}),
          ...(patch.queueState !== undefined
            ? { queueState: patch.queueState }
            : {}),
          ...(patch.activeImageId !== undefined
            ? { activeImageId: patch.activeImageId }
            : {}),
          ...(patch.failedImageIds !== undefined
            ? { failedImageIds: patch.failedImageIds }
            : {}),
          ...(patch.etaSeconds !== undefined
            ? { etaSeconds: patch.etaSeconds }
            : {}),
          ...(patch.debugStatus
            ? { debugStatus: { ...state.debugStatus, ...patch.debugStatus } }
            : {}),
          ...(patch.successOpen !== undefined
            ? { successOpen: patch.successOpen }
            : {}),
          ...(patch.errorOpen !== undefined ? { errorOpen: patch.errorOpen } : {}),
        })),
    }),
    {
      name: "app-storage",
      storage: createWorkerSafeStorage(),
      partialize: (state) => ({
        theme: state.theme,
        apiKeys: state.apiKeys,
        primaryProvider: state.primaryProvider,
        providerModels: state.providerModels,
        providerModelsFetchedAt: state.providerModelsFetchedAt,
        settings: state.settings,
        resultCache: state.resultCache,
        autoScroll: state.autoScroll,
        gitConfig: state.gitConfig,
        keyHealthCheckedAt: state.keyHealthCheckedAt,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as (Partial<AppState> & {
          apiKey?: string;
        }) | undefined;
        const validProviders: ApiProvider[] = ["gemini", "openai", "mistral"];
        const persistedPlatform = persisted?.settings?.platform;
        const validPlatform: "adobe" | "shutterstock" | "magnific" =
          persistedPlatform === "shutterstock" ? "shutterstock" : persistedPlatform === "magnific" ? "magnific" : "adobe";
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
              health: entry.health,
              models: Array.isArray(entry.models) ? entry.models : undefined,
              modelStates: entry.modelStates,
              modelsFetchedAt:
                typeof entry.modelsFetchedAt === "number"
                  ? entry.modelsFetchedAt
                  : null,
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
            metadata: result.metadata
              ? {
                  ...result.metadata,
                  editorialAssessment: normalizeEditorialAssessment(
                    result.metadata.editorialAssessment
                  ),
                }
              : result.metadata,
          }));
        }
        if (
          !merged.resultCache ||
          typeof merged.resultCache !== "object" ||
          Array.isArray(merged.resultCache)
        ) {
          merged.resultCache = {};
        }
        if (merged.gitConfig && typeof merged.gitConfig === "object") {
          merged.gitConfig = {
            ...DEFAULT_GIT_CONFIG,
            ...merged.gitConfig,
          };
        } else {
          merged.gitConfig = { ...DEFAULT_GIT_CONFIG };
        }
        if (typeof merged.keyHealthCheckedAt !== "number") {
          merged.keyHealthCheckedAt = null;
        }
        return merged;
      },
    }
  )
);
