import {
  IMAGE_API_MAX_DIMENSION,
  IMAGE_MAX_BYTES,
  ImageTooLargeError,
  compressImageDataUrl,
} from "@/lib/image-process";
import { isVectorFile, renderVectorToPng } from "@/lib/eps-render";
import type { ImageAsset } from "@/lib/types";

export type UploadPhase = "reading" | "compressing" | "converting";

export type UploadProgressItem = {
  file: File;
  phase: UploadPhase;
  progress: number;
};

export type UploadFailure = {
  name: string;
  message: string;
  tooLarge: boolean;
};

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
      const dataUrl = await readFileAsDataUrl(file, (progress) =>
        onItem?.(file, { phase: "reading", progress })
      );

      let apiDataUrl: string | undefined;
      let apiMimeType: string | undefined;
      let type = file.type || file.name.replace(/.*\./, "");

      if (isVectorFile(file)) {
        if (file.size > IMAGE_MAX_BYTES) {
          throw new ImageTooLargeError(
            `${file.name} is larger than 20 MB — use a vector file of 20 MB or less.`
          );
        }
        onItem?.(file, { phase: "converting", progress: 0 });
        const rendered = await renderVectorToPng(file);
        onItem?.(file, { phase: "converting", progress: 100 });
        const compressed = await compressImageDataUrl(
          rendered.dataUrl,
          IMAGE_MAX_BYTES,
          IMAGE_API_MAX_DIMENSION
        );
        apiDataUrl = compressed.dataUrl;
        apiMimeType = compressed.mimeType;
        type = compressed.mimeType;
      } else if (isCompressibleFile(file)) {
        onItem?.(file, { phase: "compressing", progress: 0 });
        const compressed = await compressImageDataUrl(
          dataUrl,
          IMAGE_MAX_BYTES,
          IMAGE_API_MAX_DIMENSION
        );
        apiDataUrl = compressed.dataUrl;
        apiMimeType = compressed.mimeType;
        onItem?.(file, { phase: "compressing", progress: 100 });
      } else if (file.size > IMAGE_MAX_BYTES) {
        throw new ImageTooLargeError(
          `${file.name} is larger than 20 MB. Videos and vector files cannot be compressed for the API — use a file of 20 MB or less.`
        );
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
      failures.push({
        name: file.name,
        tooLarge: error instanceof ImageTooLargeError,
        message:
          error instanceof ImageTooLargeError
            ? error.message
            : `${file.name} could not be processed. ${
                error instanceof Error ? error.message : ""
              }`,
      });
    }
  }

  return { assets, failures };
}
