import {
  ANALYSIS_MAX_DIMENSION,
  EPS_MAX_BYTES,
  EPS_MAX_FILE_SIZE_MB,
  IMAGE_MAX_BYTES,
  ImageTooLargeError,
  preparedImageFromBlob,
} from "@/lib/image-process";
import {
  isVectorFile,
  renderVectorToPng,
  VectorConversionError,
} from "@/lib/eps-render";
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url";
import { createProfiler, logProfile } from "@/lib/perf";
import type { ImageAsset } from "@/lib/types";

// Bounded concurrency for image preparation so many large files do not block
// the UI thread. This is separate from the AI generation concurrency (which
// stays at exactly 2).
const UPLOAD_CONCURRENCY = 3;

// Files at or below this size are sent to the AI as-is (no decode, no
// re-encode). Only larger/upscaled files are downscaled into an analysis
// image, so normal uploads stay essentially instant.
const USE_AS_IS_MAX_BYTES = 2 * 1024 * 1024;

export type UploadPhase = "preparing" | "converting";

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

// Create an asset immediately from a picked file. The original is never read
// into memory here: preview uses an object URL and the analysis image is
// derived later in the background.
export function createAssetFromFile(file: File): ImageAsset {
  const previewUrl = createObjectUrl(file);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    type: mimeFor(file) || file.name.replace(/.*\./, ""),
    previewUrl,
    blob: file,
  };
}

function base64FromBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not encode the file."));
    reader.readAsDataURL(blob);
  });
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

  if (isVectorFile({ name: asset.name })) {
    try {
      if (file.size > EPS_MAX_BYTES) {
        throw new EpsTooLargeError(EPS_MAX_FILE_SIZE_MB);
      }
      onItem?.(file, { phase: "converting", progress: 0 });
      profiler.start("render");
      const rendered = await renderVectorToPng(file);
      profiler.end("render");

      const renderedUrl = createObjectUrl(rendered.blob);
      revokeObjectUrl(asset.previewUrl);

      profiler.start("optimize");
      const compressed = await preparedImageFromBlob(rendered.blob, {
        maxDimension: ANALYSIS_MAX_DIMENSION,
      });
      profiler.end("optimize");

      onItem?.(file, { phase: "converting", progress: 100 });
      logProfile(`${asset.name}:upload`, profiler.result());
      return {
        failure: null,
        patch: {
          previewUrl: renderedUrl,
          blob: rendered.blob,
          type: rendered.mimeType,
          apiDataUrl: compressed.dataUrl,
          apiMimeType: compressed.mimeType,
          prepared: true,
        },
      };
    } catch (error) {
      return {
        patch: {},
        failure: {
          name: asset.name,
          tooLarge: error instanceof EpsTooLargeError,
          kind: error instanceof VectorConversionError
            ? "eps-render"
            : error instanceof EpsTooLargeError
              ? "eps-too-large"
              : "generic",
          message: error instanceof VectorConversionError
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

      // Small/normal images are sent as-is: no decode, no re-encode.
      if (file.size <= USE_AS_IS_MAX_BYTES || /\.svg$/i.test(asset.name)) {
        if (file.size > IMAGE_MAX_BYTES) {
          throw new ImageTooLargeError(
            `${asset.name} is larger than 20 MB. This file type cannot be compressed for the API — use a file of 20 MB or less.`
          );
        }
        profiler.start("read");
        const dataUrl = await base64FromBlob(file);
        profiler.end("read");
        onItem?.(file, { phase: "preparing", progress: 100 });
        logProfile(`${asset.name}:upload`, profiler.result());
        return {
          failure: null,
          patch: {
            apiDataUrl: dataUrl,
            apiMimeType: mimeFor(file),
            prepared: true,
          },
        };
      }

      profiler.start("optimize");
      const compressed = await preparedImageFromBlob(file, {
        maxDimension: ANALYSIS_MAX_DIMENSION,
      });
      profiler.end("optimize");

      onItem?.(file, { phase: "preparing", progress: 100 });
      logProfile(`${asset.name}:upload`, profiler.result());
      return {
        failure: null,
        patch: {
          apiDataUrl: compressed.dataUrl,
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
          message: error instanceof ImageTooLargeError
            ? error.message
            : `${asset.name} could not be processed. ${
                error instanceof Error ? error.message : ""
              }`,
        },
      };
    }
  }

  // Videos keep their local object URL for preview; nothing to optimize.
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

  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(UPLOAD_CONCURRENCY, assets.length) },
    async () => {
      for (;;) {
        const index = nextIndex++;
        if (index >= assets.length) return;
        const asset = assets[index];
        const { patch, failure } = await optimizeAsset(asset, opts.onItem);
        if (failure) failures.push(failure);
        opts.onReady?.(asset.id, patch);
      }
    }
  );
  await Promise.all(workers);

  return failures;
}
