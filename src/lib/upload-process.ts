import {
  ANALYSIS_MAX_DIMENSION,
  EPS_MAX_BYTES,
  EPS_MAX_FILE_SIZE_MB,
  IMAGE_MAX_BYTES,
  ImageTooLargeError,
  prepareCompressedBlob,
} from "@/lib/image-process";
import { compressImageBlob } from "@/lib/image-worker-client";
import {
  isVectorFile,
  renderVectorToPng,
  VectorConversionError,
} from "@/lib/eps-render";
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url";
import { createProfiler, logProfile } from "@/lib/perf";
import type { ImageAsset } from "@/lib/types";

const UPLOAD_CONCURRENCY = 4;
// EPS conversion is the most expensive off-main-thread operation (Ghostscript +
// WASM). Run it at a concurrency of 1 by default and cap it at 2 so parallel
// conversions never starve the browser or exhaust memory on large EPS files.
const EPS_CONCURRENCY = 1;
const EPS_CONCURRENCY_MAX = 2;

const USE_AS_IS_MAX_BYTES = 2 * 1024 * 1024;

export type UploadPhase = "preparing" | "converting" | "uploading";

export type UploadProgressItem = {
  file: File;
  phase: UploadPhase;
  progress: number;
};

export type UploadFailureKind =
  | "too-large"
  | "eps-too-large"
  | "eps-render"
  | "generic";

export type UploadFailure = {
  name: string;
  message: string;
  tooLarge: boolean;
  kind: UploadFailureKind;
};

export class EpsTooLargeError extends Error {
  constructor(maxMb: number) {
    super(
      `EPS file is too large for processing. Maximum supported size: ${maxMb} MB.`
    );
    this.name = "EpsTooLargeError";
  }
}

function vectorRenderErrorMessage(name: string): string {
  return /\.eps$/i.test(name)
    ? "Unable to render this EPS file. The file may be corrupted or use unsupported EPS features."
    : "Unable to render this PostScript file. The file may be corrupted or use unsupported PostScript features.";
}

export function isSupportedFile(file: File): boolean {
  if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
    return true;
  }
  return /\.(svg|eps|ps)$/i.test(file.name);
}

export function isCompressibleFile(file: File): boolean {
  if (!file.type.startsWith("image/")) return false;
  return !/\.(svg|eps|ps)$/i.test(file.name);
}

export function isPreviewableType(type: string): boolean {
  return type.startsWith("image/") || type.startsWith("video/");
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

function mimeFor(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.replace(/.*\./, "").toLowerCase();
  return EXT_MIME[ext] ?? "";
}

export function createAssetFromFile(file: File): ImageAsset {
  const previewUrl = createObjectUrl(file);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    type: mimeFor(file) || file.name.replace(/.*\./, ""),
    previewUrl,
    blob: file,
    epsStatus: isVectorFile({ name: file.name }) ? "queued" : undefined,
  };
}

type OptimizeResult = {
  patch: Partial<ImageAsset>;
  failure: UploadFailure | null;
};

async function optimizeAsset(
  asset: ImageAsset,
  onItem?: (file: File, patch: Partial<UploadProgressItem>) => void
): Promise<OptimizeResult> {
  const file = asset.blob as File;
  const profiler = createProfiler();
  const t0 = performance.now();

  if (isVectorFile({ name: asset.name })) {
    try {
      if (file.size > EPS_MAX_BYTES) {
        throw new EpsTooLargeError(EPS_MAX_FILE_SIZE_MB);
      }

      onItem?.(file, { phase: "uploading", progress: 0 });
      useAppStore.getState().updateImage(asset.id, { epsStatus: "uploading" });

      profiler.start("render");
      const tRenderStart = performance.now();
      const rendered = await renderVectorToPng(file);
      const renderMs = performance.now() - tRenderStart;
      profiler.end("render");

      useAppStore.getState().updateImage(asset.id, { epsStatus: "converting" });
      onItem?.(file, { phase: "converting", progress: 50 });

      const renderedUrl = createObjectUrl(rendered.blob);
      revokeObjectUrl(asset.previewUrl);

      profiler.start("compress");
      const workerResult = compressImageBlob(rendered.blob, {
        maxDimension: ANALYSIS_MAX_DIMENSION,
        maxBytes: IMAGE_MAX_BYTES,
      });
      const compressed = workerResult
        ? await workerResult
        : await prepareCompressedBlob(rendered.blob, {
            maxDimension: ANALYSIS_MAX_DIMENSION,
          });
      profiler.end("compress");

      onItem?.(file, { phase: "converting", progress: 100 });
      useAppStore.getState().updateImage(asset.id, { epsStatus: "ready" });

      logProfile(`${asset.name}:upload`, profiler.result());
      console.log(
        `[Upload] ${asset.name}: EPS→PNG→Blob in ${(performance.now() - t0).toFixed(0)}ms (render=${renderMs.toFixed(0)}ms blob=${formatBytes(compressed.blob.size)})`
      );
      if (process.env.NODE_ENV !== "production") {
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        console.log(
          `[Perf] EPS converted: render=${renderMs.toFixed(0)}ms compress=${
            profiler.result().compress ?? 0
          }ms heap=${mem ? (mem.usedJSHeapSize / 1048576).toFixed(1) + "MB" : "n/a"}`
        );
      }
      return {
        failure: null,
        patch: {
          previewUrl: renderedUrl,
          blob: rendered.blob,
          type: rendered.mimeType,
          apiBlob: compressed.blob,
          apiMimeType: compressed.mimeType,
          prepared: true,
          epsStatus: "ready",
        },
      };
    } catch (error) {
      useAppStore.getState().updateImage(asset.id, { epsStatus: "failed" });
      return {
        patch: { epsStatus: "failed" },
        failure: {
          name: asset.name,
          tooLarge: error instanceof EpsTooLargeError,
          kind:
            error instanceof VectorConversionError
              ? "eps-render"
              : error instanceof EpsTooLargeError
                ? "eps-too-large"
                : "generic",
          message:
            error instanceof VectorConversionError
              ? vectorRenderErrorMessage(asset.name)
              : error instanceof EpsTooLargeError
                ? error.message
                : `${asset.name} could not be processed. ${
                    error instanceof Error ? error.message : ""
                  }`,
        },
      };
    }
  }

  const fileMime = mimeFor(file);
  if (fileMime.startsWith("image/")) {
    try {
      onItem?.(file, { phase: "preparing", progress: 30 });

      if (file.size <= USE_AS_IS_MAX_BYTES || /\.svg$/i.test(asset.name)) {
        if (file.size > IMAGE_MAX_BYTES) {
          throw new ImageTooLargeError(
            `${asset.name} is larger than 20 MB. This file type cannot be compressed for the API — use a file of 20 MB or less.`
          );
        }
        onItem?.(file, { phase: "preparing", progress: 100 });
        logProfile(`${asset.name}:upload`, profiler.result());
        console.log(
          `[Upload] ${asset.name}: stored as-is in ${(performance.now() - t0).toFixed(0)}ms (size=${formatBytes(file.size)})`
        );
        return {
          failure: null,
          patch: {
            apiBlob: file,
            apiMimeType: mimeFor(file),
            prepared: true,
          },
        };
      }

      profiler.start("compress");
      const workerResult = compressImageBlob(file, {
        maxDimension: ANALYSIS_MAX_DIMENSION,
        maxBytes: IMAGE_MAX_BYTES,
      });
      const compressed = workerResult
        ? await workerResult
        : await prepareCompressedBlob(file, {
            maxDimension: ANALYSIS_MAX_DIMENSION,
          });
      profiler.end("compress");

      onItem?.(file, { phase: "preparing", progress: 100 });
      logProfile(`${asset.name}:upload`, profiler.result());
      console.log(
        `[Upload] ${asset.name}: compressed in ${(performance.now() - t0).toFixed(0)}ms (original=${formatBytes(file.size)} → blob=${formatBytes(compressed.blob.size)})`
      );
      return {
        failure: null,
        patch: {
          apiBlob: compressed.blob,
          apiMimeType: compressed.mimeType,
          prepared: true,
        },
      };
    } catch (error) {
      return {
        patch: {},
        failure: {
          name: asset.name,
          tooLarge: error instanceof ImageTooLargeError,
          kind: error instanceof ImageTooLargeError ? "too-large" : "generic",
          message:
            error instanceof ImageTooLargeError
              ? error.message
              : `${asset.name} could not be processed. ${
                  error instanceof Error ? error.message : ""
                }`,
        },
      };
    }
  }

  return { patch: {}, failure: null };
}

export async function processAssetsForAnalysis(
  assets: ImageAsset[],
  opts: {
    onItem?: (file: File, patch: Partial<UploadProgressItem>) => void;
    onReady?: (assetId: string, patch: Partial<ImageAsset>) => void;
  } = {}
): Promise<UploadFailure[]> {
  const failures: UploadFailure[] = [];

  const epsAssets: ImageAsset[] = [];
  const otherAssets: ImageAsset[] = [];
  for (const asset of assets) {
    if (isVectorFile({ name: asset.name })) {
      epsAssets.push(asset);
    } else {
      otherAssets.push(asset);
    }
  }

  const processOther = async () => {
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(UPLOAD_CONCURRENCY, otherAssets.length) },
      async () => {
        for (;;) {
          const index = nextIndex++;
          if (index >= otherAssets.length) return;
          const asset = otherAssets[index];
          const { patch, failure } = await optimizeAsset(asset, opts.onItem);
          if (failure) failures.push(failure);
          opts.onReady?.(asset.id, patch);
        }
      }
    );
    await Promise.all(workers);
  };

  const processEps = async () => {
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(EPS_CONCURRENCY, EPS_CONCURRENCY_MAX, epsAssets.length) },
      async () => {
        for (;;) {
          const index = nextIndex++;
          if (index >= epsAssets.length) return;
          const asset = epsAssets[index];
          const { patch, failure } = await optimizeAsset(asset, opts.onItem);
          if (failure) failures.push(failure);
          opts.onReady?.(asset.id, patch);
        }
      }
    );
    await Promise.all(workers);
  };

  await Promise.all([processOther(), processEps()]);

  return failures;
}

import { useAppStore } from "@/store/use-app-store";
