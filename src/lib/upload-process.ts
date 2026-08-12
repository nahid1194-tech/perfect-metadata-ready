import {
  EPS_MAX_BYTES,
  EPS_MAX_FILE_SIZE_MB,
  IMAGE_API_MAX_DIMENSION,
  IMAGE_MAX_BYTES,
  ImageTooLargeError,
  compressImageDataUrl,
} from "@/lib/image-process";
import {
  isVectorFile,
  renderVectorToPng,
  VectorConversionError,
} from "@/lib/eps-render";
import type { ImageAsset } from "@/lib/types";

export type UploadPhase = "reading" | "compressing" | "converting";

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

function readFileAsDataUrl(
  file: File,
  onProgress: (progress: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

export async function processUploadFiles(
  files: File[],
  onItem?: (file: File, patch: Partial<UploadProgressItem>) => void
): Promise<{ assets: ImageAsset[]; failures: UploadFailure[] }> {
  const assets: ImageAsset[] = [];
  const failures: UploadFailure[] = [];

  for (const file of files) {
    try {
      let dataUrl: string;
      let apiDataUrl: string | undefined;
      let apiMimeType: string | undefined;
      let type = file.type || file.name.replace(/.*\./, "");

      if (isVectorFile(file)) {
        if (file.size > EPS_MAX_BYTES) {
          throw new EpsTooLargeError(EPS_MAX_FILE_SIZE_MB);
        }
        onItem?.(file, { phase: "converting", progress: 0 });
        const rendered = await renderVectorToPng(file);
        onItem?.(file, { phase: "converting", progress: 100 });
        const compressed = await compressImageDataUrl(
          rendered.dataUrl,
          IMAGE_MAX_BYTES,
          IMAGE_API_MAX_DIMENSION
        );
        dataUrl = compressed.dataUrl;
        apiDataUrl = compressed.dataUrl;
        apiMimeType = compressed.mimeType;
        type = compressed.mimeType;
      } else {
        dataUrl = await readFileAsDataUrl(file, (progress) =>
          onItem?.(file, { phase: "reading", progress })
        );
        if (isCompressibleFile(file)) {
          onItem?.(file, { phase: "compressing", progress: 0 });
          const compressed = await compressImageDataUrl(
            dataUrl,
            IMAGE_MAX_BYTES,
            IMAGE_API_MAX_DIMENSION
          );
          apiDataUrl = compressed.dataUrl;
          apiMimeType = compressed.mimeType;
          type = compressed.mimeType;
          onItem?.(file, { phase: "compressing", progress: 100 });
        } else if (file.size > IMAGE_MAX_BYTES) {
          throw new ImageTooLargeError(
            `${file.name} is larger than 20 MB. This file type cannot be compressed for the API — use a file of 20 MB or less.`
          );
        }
      }

      assets.push({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type,
        dataUrl,
        apiDataUrl,
        apiMimeType,
      });
    } catch (error) {
      const epsRenderFailure = error instanceof VectorConversionError;
      const epsTooLarge = error instanceof EpsTooLargeError;
      const rasterTooLarge = error instanceof ImageTooLargeError;
      failures.push({
        name: file.name,
        tooLarge: epsTooLarge || rasterTooLarge,
        kind: epsRenderFailure
          ? "eps-render"
          : epsTooLarge
            ? "eps-too-large"
            : rasterTooLarge
              ? "too-large"
              : "generic",
        message: epsRenderFailure
          ? vectorRenderErrorMessage(file.name)
          : epsTooLarge || rasterTooLarge
            ? error.message
            : `${file.name} could not be processed. ${
                error instanceof Error ? error.message : ""
              }`,
      });
    }
  }

  return { assets, failures };
}
