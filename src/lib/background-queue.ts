import { hasLocalStorage } from "@/lib/worker-storage";
import { useAppStore } from "@/store/use-app-store";
import { useToastStore } from "@/store/use-toast-store";
import type {
  ApiKeyEntry,
  ApiProvider,
  GenerationResult,
  GenerationSettings,
  ImageAsset,
  JobStatus,
  PersistedJob,
  QueueItem,
  WorkerSnapshot,
} from "@/lib/types";

const JOB_STORAGE_KEY = "perfect-metadata:background-job:v1";
const PERSIST_DEBOUNCE_MS = 800;
const JOB_BUDGET = 4_000_000;

type InitPayload = {
  apiKeys: ApiKeyEntry[];
  settings: GenerationSettings;
  primaryProvider: ApiProvider;
  providerModels: Record<ApiProvider, string[]>;
  providerModelsFetchedAt: Record<ApiProvider, number | null>;
  images: ImageAsset[];
  resultCache: Record<string, GenerationResult>;
};

type WorkerCommand =
  | { type: "init"; payload: InitPayload }
  | { type: "start"; payload?: { ids?: string[]; retryFailed?: boolean } }
  | { type: "retryImage"; payload: { imageId: string } }
  | { type: "stop" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cancelImage"; payload: { imageId: string } }
  | { type: "removeImage"; payload: { imageId: string } }
  | { type: "clearImages" };

let worker: Worker | null = null;
let lastSnap: WorkerSnapshot | null = null;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function ensureWorker(): Worker {
  if (worker) return worker;
  const instance = new Worker(
    new URL("../workers/generation.worker.ts", import.meta.url)
  );
  instance.addEventListener("message", onWorkerMessage);
  instance.addEventListener("error", onWorkerRuntimeError);
  worker = instance;
  return instance;
}

function post(command: WorkerCommand): void {
  ensureWorker().postMessage(command);
}

function resetUiState(): void {
  useAppStore.getState().applyWorkerSnapshot({
    generating: false,
    queueState: "idle",
    activeImageId: null,
    etaSeconds: null,
  });
}

function onWorkerRuntimeError(event: ErrorEvent): void {
  console.error("[BackgroundQueue] Worker runtime error", event);
  resetUiState();
  useToastStore.getState().add({
    type: "error",
    title: "Background queue stopped",
    description:
      event.message || "The background generation worker failed unexpectedly.",
  });
}

function onWorkerMessage(event: MessageEvent): void {
  const message = event.data;
  if (!message || typeof message.type !== "string") return;

  switch (message.type) {
    case "state":
      applySnapshot(message.state as WorkerSnapshot);
      break;
    case "toast":
      useToastStore.getState().add(message.toast);
      break;
    case "resultCache":
      mergeResultCache(message.cache as Record<string, GenerationResult>);
      break;
    case "error":
      useToastStore.getState().add({
        type: "error",
        title: "Generation error",
        description:
          typeof message.message === "string"
            ? message.message
            : "An unexpected error occurred during generation.",
      });
      break;
  }
}

function mergeResultCache(cache: Record<string, GenerationResult>): void {
  const store = useAppStore.getState();
  for (const [key, result] of Object.entries(cache)) {
    if (!store.resultCache[key]) store.setResultCache(key, result);
  }
}

function applySnapshot(snap: WorkerSnapshot): void {
  lastSnap = snap;

  const store = useAppStore.getState();
  const imageIds = new Set(store.images.map((image) => image.id));

  const results = snap.results.filter((result) => imageIds.has(result.imageId));
  const queueItems: Record<string, QueueItem> = {};
  for (const [id, item] of Object.entries(snap.queueItems)) {
    if (imageIds.has(id)) queueItems[id] = item;
  }

  if (snap.apiPrepared) {
    for (const [id, patch] of Object.entries(snap.apiPrepared)) {
      if (!imageIds.has(id)) continue;
      const current = store.images.find((image) => image.id === id);
      if (!current) continue;
      const updates: Partial<ImageAsset> = {};
      if (
        patch.apiDataUrl !== undefined &&
        current.apiDataUrl !== patch.apiDataUrl
      ) {
        updates.apiDataUrl = patch.apiDataUrl;
      }
      if (current.apiMimeType !== patch.apiMimeType) {
        updates.apiMimeType = patch.apiMimeType;
      }
      if (Object.keys(updates).length > 0) {
        store.updateImage(id, updates);
      }
    }
  }

  store.applyWorkerSnapshot({
    results,
    queueItems,
    batchTotal: snap.batchTotal,
    batchCompleted: snap.batchCompleted,
    progress: snap.progress,
    generating: snap.generating,
    queueState: snap.queueState,
    activeImageId: snap.activeImageId,
    failedImageIds: snap.failedImageIds,
    etaSeconds: snap.etaSeconds,
    debugStatus: snap.debugStatus,
    successOpen: snap.successOpen,
    errorOpen: snap.errorOpen,
  });

  schedulePersist();
}

function jobStatus(snap: WorkerSnapshot): JobStatus {
  if (snap.queueState === "paused") return "paused";
  if (snap.generating) {
    return snap.queueState === "stopped" ? "cancelled" : "processing";
  }
  if (snap.batchTotal === 0) return "queued";
  const items = Object.values(snap.queueItems);
  if (items.length === 0) return "queued";
  const completed = items.filter((item) => item.status === "completed").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const cancelled = items.filter((item) => item.status === "cancelled").length;
  if (completed === items.length) return "completed";
  if (cancelled > 0 && completed + failed + cancelled === items.length) {
    return "cancelled";
  }
  if (failed === items.length) return "failed";
  return "processing";
}

function countCancelled(items: Record<string, QueueItem>): number {
  let count = 0;
  for (const item of Object.values(items)) {
    if (item.status === "cancelled") count++;
  }
  return count;
}

function collectErrors(items: Record<string, QueueItem>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [id, item] of Object.entries(items)) {
    if (item.status === "failed" && item.error) errors[id] = item.error;
  }
  return errors;
}

function persistedCreatedAt(currentJobId: string): number {
  if (!hasLocalStorage()) return Date.now();
  try {
    const raw = localStorage.getItem(JOB_STORAGE_KEY);
    if (!raw) return Date.now();
    const parsed = JSON.parse(raw) as PersistedJob;
    if (parsed.jobId === currentJobId && typeof parsed.createdAt === "number") {
      return parsed.createdAt;
    }
  } catch {
    // Ignore corrupt persisted job data.
  }
  return Date.now();
}

function schedulePersist(): void {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    persistNow();
  }, PERSIST_DEBOUNCE_MS);
}

export function persistNow(): void {
  if (!hasLocalStorage()) return;
  const snap = lastSnap;
  if (!snap) return;
  if (snap.batchTotal === 0 && !snap.generating && snap.results.length === 0) {
    clearPersistedJob();
    return;
  }

  const store = useAppStore.getState();
  const job: PersistedJob = {
    jobId: snap.jobId,
    status: jobStatus(snap),
    total: snap.batchTotal,
    completed: snap.batchCompleted,
    failed: snap.failedImageIds.length,
    cancelled: countCancelled(snap.queueItems),
    remaining: Math.max(
      0,
      snap.batchTotal - snap.batchCompleted - snap.failedImageIds.length
    ),
    currentImageId: snap.activeImageId,
    currentImageName:
      store.images.find((image) => image.id === snap.activeImageId)?.name ??
      null,
    progress: snap.progress,
    results: snap.results,
    queueItems: snap.queueItems,
    errors: collectErrors(snap.queueItems),
    failedImageIds: snap.failedImageIds,
    images: store.images.map((image) => ({
      id: image.id,
      name: image.name,
      type: image.type,
      size: image.size,
      dataUrl: image.dataUrl,
      apiDataUrl: image.apiDataUrl,
      apiMimeType: image.apiMimeType,
    })),
    settings: store.settings,
    apiKeys: store.apiKeys,
    primaryProvider: store.primaryProvider,
    providerModels: store.providerModels,
    providerModelsFetchedAt: store.providerModelsFetchedAt,
    createdAt: persistedCreatedAt(snap.jobId),
    updatedAt: Date.now(),
  };

  const write = (value: unknown): boolean => {
    try {
      const raw = JSON.stringify(value);
      if (raw.length > JOB_BUDGET) return false;
      localStorage.setItem(JOB_STORAGE_KEY, raw);
      return true;
    } catch {
      return false;
    }
  };

  if (write(job)) return;
  const withoutOriginals = {
    ...job,
    images: job.images.map((image) => ({
      id: image.id,
      name: image.name,
      type: image.type,
      size: image.size,
      apiDataUrl: image.apiDataUrl,
      apiMimeType: image.apiMimeType,
    })),
  };
  if (write(withoutOriginals)) return;
  write({ ...job, images: [] });
}

function clearPersistedJob(): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(JOB_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

function sendInit(): void {
  const store = useAppStore.getState();
  post({
    type: "init",
    payload: {
      apiKeys: store.apiKeys,
      settings: store.settings,
      primaryProvider: store.primaryProvider,
      providerModels: store.providerModels,
      providerModelsFetchedAt: store.providerModelsFetchedAt,
      images: store.images,
      resultCache: store.resultCache,
    },
  });
}

export function startBackgroundJob(opts: { ids?: string[]; retryFailed?: boolean } = {}): void {
  const store = useAppStore.getState();
  if (store.generating) {
    useToastStore.getState().add({
      type: "info",
      title: "Already running",
      description: "Wait for the current generation to finish.",
    });
    return;
  }
  store.closeSuccess();
  store.closeError();
  ensureWorker();
  sendInit();
  post({ type: "start", payload: opts });
}

export function stopBackgroundJob(): void {
  if (!worker) return;
  post({ type: "stop" });
}

export function pauseBackgroundJob(): void {
  if (!worker) return;
  post({ type: "pause" });
}

export function resumeBackgroundQueue(): void {
  if (!worker) return;
  post({ type: "resume" });
}

export function cancelBackgroundImage(imageId: string): void {
  if (!worker) return;
  post({ type: "cancelImage", payload: { imageId } });
}

export function retryBackgroundImage(imageId: string): Promise<void> {
  const store = useAppStore.getState();
  if (store.generating) {
    useToastStore.getState().add({
      type: "info",
      title: "Already running",
      description: "Wait for the current generation to finish.",
    });
    return Promise.reject(new Error("A generation is already running."));
  }
  ensureWorker();
  sendInit();
  post({ type: "retryImage", payload: { imageId } });
  return Promise.resolve();
}

export type RestoredJob = {
  job: PersistedJob;
  interrupted: boolean;
  hasImages: boolean;
};

export function restoreBackgroundJob(): RestoredJob | null {
  if (!hasLocalStorage()) return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(JOB_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let job: PersistedJob;
  try {
    job = JSON.parse(raw) as PersistedJob;
  } catch {
    clearPersistedJob();
    return null;
  }
  if (!job || typeof job !== "object" || !job.jobId) {
    clearPersistedJob();
    return null;
  }

  const interrupted =
    job.status === "queued" ||
    job.status === "processing" ||
    job.status === "paused";

  if (Array.isArray(job.images) && job.images.length > 0) {
    const store = useAppStore.getState();
    store.clearImages();
    store.addImages(
      job.images.map((image) => ({
        id: image.id,
        name: image.name,
        type: image.type,
        size: image.size,
        dataUrl: image.dataUrl ?? "",
        apiDataUrl: image.apiDataUrl,
        apiMimeType: image.apiMimeType,
      }))
    );
    store.applyWorkerSnapshot({
      results: Array.isArray(job.results) ? job.results : [],
      queueItems: job.queueItems ?? {},
      batchTotal: job.total,
      batchCompleted: job.completed,
      progress: job.progress,
      generating: false,
      queueState: "idle",
      activeImageId: null,
      failedImageIds: Array.isArray(job.failedImageIds)
        ? job.failedImageIds
        : [],
      etaSeconds: null,
      successOpen: false,
      errorOpen: false,
    });
    return { job, interrupted, hasImages: true };
  }

  return { job, interrupted, hasImages: false };
}

export function dismissBackgroundJob(): void {
  clearPersistedJob();
}

export function resumeInterruptedBackgroundJob(): void {
  const restored = restoreBackgroundJob();
  if (!restored || !restored.hasImages) {
    clearPersistedJob();
    return;
  }

  const job = restored.job;
  const store = useAppStore.getState();
  const remaining = store.images
    .filter((image) => {
      const item = job.queueItems?.[image.id];
      return !item || item.status !== "completed";
    })
    .filter(
      (image) =>
        Boolean(image.apiDataUrl) ||
        Boolean(image.blob) ||
        Boolean(image.dataUrl) ||
        Boolean(image.previewUrl)
    )
    .map((image) => image.id);

  if (remaining.length === 0) {
    clearPersistedJob();
    return;
  }

  clearPersistedJob();
  startBackgroundJob({ ids: remaining });
}
