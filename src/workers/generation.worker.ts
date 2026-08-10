import {
  cancelImage,
  pauseQueue,
  resumeQueue,
  retryImage,
  runQueue,
  stopQueue,
} from "@/lib/queue";
import { useAppStore } from "@/store/use-app-store";
import { useToastStore } from "@/store/use-toast-store";
import type {
  ApiKeyEntry,
  ApiProvider,
  GenerationResult,
  GenerationSettings,
  ImageAsset,
  WorkerSnapshot,
} from "@/lib/types";

type InitPayload = {
  apiKeys: ApiKeyEntry[];
  settings: GenerationSettings;
  primaryProvider: ApiProvider;
  providerModels: Record<ApiProvider, string[]>;
  providerModelsFetchedAt: Record<ApiProvider, number | null>;
  images: ImageAsset[];
  resultCache: Record<string, GenerationResult>;
};

type Command =
  | { type: "init"; payload: InitPayload }
  | { type: "start"; payload?: { ids?: string[]; retryFailed?: boolean } }
  | { type: "retryImage"; payload: { imageId: string } }
  | { type: "stop" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cancelImage"; payload: { imageId: string } }
  | { type: "removeImage"; payload: { imageId: string } }
  | { type: "clearImages" };

const jobId = crypto.randomUUID();

function post(message: unknown): void {
  self.postMessage(message);
}

function handleInit(payload: InitPayload): void {
  const store = useAppStore.getState();
  store.setApiKeys(payload.apiKeys);
  store.setSettings(payload.settings);
  store.setPrimaryProvider(payload.primaryProvider);
  const providers: ApiProvider[] = ["gemini", "openai", "mistral"];
  for (const provider of providers) {
    store.setProviderModels(
      provider,
      payload.providerModels[provider],
      payload.providerModelsFetchedAt[provider] ?? 0
    );
  }
  store.clearImages();
  store.addImages(payload.images);
  for (const [key, result] of Object.entries(payload.resultCache)) {
    store.setResultCache(key, result);
  }
}

function buildSnapshot(): WorkerSnapshot {
  const state = useAppStore.getState();
  const apiPrepared: WorkerSnapshot["apiPrepared"] = {};
  for (const image of state.images) {
    if (image.apiDataUrl || image.apiMimeType) {
      apiPrepared[image.id] = {
        apiDataUrl: image.apiDataUrl,
        apiMimeType: image.apiMimeType,
      };
    }
  }
  return {
    jobId,
    results: state.results,
    queueItems: state.queueItems,
    batchTotal: state.batchTotal,
    batchCompleted: state.batchCompleted,
    progress: state.progress,
    generating: state.generating,
    queueState: state.queueState,
    activeImageId: state.activeImageId,
    failedImageIds: state.failedImageIds,
    etaSeconds: state.etaSeconds,
    debugStatus: state.debugStatus,
    successOpen: state.successOpen,
    errorOpen: state.errorOpen,
    apiPrepared,
  };
}

let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
let lastSnapshotAt = 0;
const SNAPSHOT_THROTTLE_MS = 90;

function scheduleSnapshot(): void {
  const now = Date.now();
  if (now - lastSnapshotAt >= SNAPSHOT_THROTTLE_MS) {
    lastSnapshotAt = now;
    post({ type: "state", state: buildSnapshot() });
    return;
  }
  if (snapshotTimer !== undefined) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    lastSnapshotAt = Date.now();
    post({ type: "state", state: buildSnapshot() });
  }, SNAPSHOT_THROTTLE_MS);
}

let lastCacheSize = 0;

useAppStore.subscribe(() => {
  scheduleSnapshot();
  const state = useAppStore.getState();
  const size = Object.keys(state.resultCache).length;
  if (size !== lastCacheSize) {
    lastCacheSize = size;
    post({ type: "resultCache", cache: state.resultCache });
  }
});

const knownToastIds = new Set<string>();

useToastStore.subscribe((state) => {
  for (const current of state.toasts) {
    if (knownToastIds.has(current.id)) continue;
    knownToastIds.add(current.id);
    post({ type: "toast", toast: current });
  }
});

function postError(message: string): void {
  post({ type: "error", message });
}

self.addEventListener("message", (event: MessageEvent<Command>) => {
  const message = event.data;
  if (!message || typeof message.type !== "string") return;

  switch (message.type) {
    case "init":
      handleInit(message.payload);
      break;
    case "start":
      void runQueue(message.payload ?? {}).catch((error) => {
        const store = useAppStore.getState();
        store.setGenerating(false);
        store.setQueueState("idle");
        postError(
          error instanceof Error
            ? error.message
            : "Background generation failed unexpectedly."
        );
      });
      break;
    case "retryImage":
      void retryImage(message.payload.imageId).catch((error) => {
        postError(
          error instanceof Error ? error.message : "Could not retry this image."
        );
      });
      break;
    case "stop":
      stopQueue();
      break;
    case "pause":
      pauseQueue();
      break;
    case "resume":
      resumeQueue();
      break;
    case "cancelImage":
      cancelImage(message.payload.imageId);
      break;
    case "removeImage":
      useAppStore.getState().removeImage(message.payload.imageId);
      break;
    case "clearImages":
      useAppStore.getState().clearImages();
      break;
  }
});
