import type { ImageAsset } from "@/lib/types";
import { useAppStore } from "@/store/use-app-store";

export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

const DEFAULT_ANALYSIS_MAX_DIMENSION = 2048;
const DEFAULT_ANALYSIS_QUALITY_MAX_DIMENSION = 3072;

function readPositiveInt(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  const parsed = raw == null ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Maximum edge length of the derived image sent to the AI for analysis.
export const ANALYSIS_MAX_DIMENSION = readPositiveInt(
  "NEXT_PUBLIC_MAX_ANALYSIS_DIMENSION",
  DEFAULT_ANALYSIS_MAX_DIMENSION
);

// Higher-resolution fallback used once when the standard analysis fails
// validation. Enabled only when it is larger than ANALYSIS_MAX_DIMENSION.
export const ANALYSIS_QUALITY_MAX_DIMENSION = readPositiveInt(
  "NEXT_PUBLIC_MAX_ANALYSIS_QUALITY_DIMENSION",
  DEFAULT_ANALYSIS_QUALITY_MAX_DIMENSION
);

const DEFAULT_EPS_MAX_MB = 50;

function readEpsMaxMb(): number {
  const raw = process.env.NEXT_PUBLIC_MAX_EPS_FILE_SIZE_MB;
  const parsed = raw == null ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EPS_MAX_MB;
}

export const EPS_MAX_FILE_SIZE_MB = readEpsMaxMb();
export const EPS_MAX_BYTES = EPS_MAX_FILE_SIZE_MB * 1024 * 1024;

const MIN_DIMENSION = 1024;

// JPEG/WebP quality stays within the 0.82-0.90 range so the analysis image
// remains sharp without bloating the API payload.
const QUALITY_STEPS = [0.9, 0.86, 0.82];

type PreparedEntry = { dataUrl: string; mimeType: string };

// Cached per image id and dimension so retries, key/model rotations and the
// quality fallback reuse the same prepared image instead of recompressing.
const preparedCache = new Map<string, PreparedEntry>();

function preparedCacheKey(imageId: string, maxDimension: number): string {
  return `${imageId}@${maxDimension}`;
}

export async function prepareImageForApi(
  image: ImageAsset,
  opts: { maxDimension?: number } = {}
): Promise<PreparedEntry> {
  const maxDimension = opts.maxDimension ?? ANALYSIS_MAX_DIMENSION;
  const cacheKey = preparedCacheKey(image.id, maxDimension);
  const cached = preparedCache.get(cacheKey);
  if (cached) return cached;

  // The asset already carries a prepared analysis image at the standard
  // resolution (created at upload time) — reuse it instead of recompressing.
  if (
    image.apiDataUrl &&
    image.apiMimeType &&
    maxDimension === ANALYSIS_MAX_DIMENSION
  ) {
    const entry = { dataUrl: image.apiDataUrl, mimeType: image.apiMimeType };
    preparedCache.set(cacheKey, entry);
    return entry;
  }

  try {
    const compressed = await compressImageDataUrl(
      image.dataUrl,
      IMAGE_MAX_BYTES,
      maxDimension
    );
    preparedCache.set(cacheKey, compressed);
    if (maxDimension === ANALYSIS_MAX_DIMENSION) {
      useAppStore.getState().updateImage(image.id, {
        apiDataUrl: compressed.dataUrl,
        apiMimeType: compressed.mimeType,
      });
    }
    return compressed;
  } catch (error) {
    console.warn(
      "[Image] Could not compress for the API, sending the original image",
      error
    );
    return { dataUrl: image.dataUrl, mimeType: image.type };
  }
}

export function clearPreparedCache(): void {
  preparedCache.clear();
}

export class ImageTooLargeError extends Error {
  constructor(
    message = "The image is still larger than 20 MB after compression and cannot be sent to the API."
  ) {
    super(message);
    this.name = "ImageTooLargeError";
  }
}

const IS_WORKER =
  typeof document === "undefined" && typeof window === "undefined";

function loadImage(src: string): Promise<HTMLImageElement | ImageBitmap> {
  if (IS_WORKER) {
    return (async () => {
      const blob = await (await fetch(src)).blob();
      return createImageBitmap(blob);
    })();
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("Could not read the image for compression."));
    img.src = src;
  });
}

function createCanvas(
  width: number,
  height: number
): HTMLCanvasElement | OffscreenCanvas {
  if (IS_WORKER) return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number
): Promise<Blob | null> {
  if (IS_WORKER) {
    return (canvas as OffscreenCanvas).convertToBlob({ type, quality });
  }
  return new Promise((resolve) =>
    (canvas as HTMLCanvasElement).toBlob(resolve, type, quality)
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("Could not encode the compressed image."));
    reader.readAsDataURL(blob);
  });
}

function hasMeaningfulTransparency(
  image: HTMLImageElement | ImageBitmap
): boolean {
  const maxDim = 64;
  const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return false;
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  let transparent = 0;
  let sampled = 0;
  for (let i = 3; i < data.length; i += 4) {
    sampled++;
    if (data[i] < 250) transparent++;
  }
  return sampled > 0 && transparent / sampled > 0.01;
}

export async function compressImageDataUrl(
  dataUrl: string,
  targetMaxBytes: number,
  maxDimension = ANALYSIS_MAX_DIMENSION,
  opts: { preserveAlpha?: boolean } = {}
): Promise<PreparedEntry> {
  const image = await loadImage(dataUrl);
  if (!image.width || !image.height) {
    throw new Error("The image could not be loaded for compression.");
  }

  const preserveAlpha = opts.preserveAlpha !== false;
  const transparent = preserveAlpha && hasMeaningfulTransparency(image);

  // Never upscale: start from the original size capped at maxDimension.
  const largest = Math.max(image.width, image.height);
  let dimension = Math.min(maxDimension, largest);

  for (;;) {
    const scale = dimension / largest;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("Could not initialize image compression.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, width, height);

    // Preserve alpha for transparent images: PNG first, then WebP (both keep
    // the alpha channel). Never flatten to JPEG so the analysis can still
    // detect the transparency accurately.
    if (transparent) {
      const png = await canvasToBlob(canvas, "image/png", QUALITY_STEPS[0]);
      if (png && png.size <= targetMaxBytes) {
        return { dataUrl: await blobToDataUrl(png), mimeType: "image/png" };
      }
      for (const quality of QUALITY_STEPS) {
        const webp = await canvasToBlob(canvas, "image/webp", quality);
        if (webp && webp.size <= targetMaxBytes) {
          return { dataUrl: await blobToDataUrl(webp), mimeType: "image/webp" };
        }
      }
    } else {
      for (const quality of QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, "image/jpeg", quality);
        if (blob && blob.size <= targetMaxBytes) {
          return { dataUrl: await blobToDataUrl(blob), mimeType: "image/jpeg" };
        }
      }
    }

    if (dimension > MIN_DIMENSION) {
      dimension = Math.max(MIN_DIMENSION, Math.round(dimension * 0.75));
      continue;
    }
    throw new ImageTooLargeError();
  }
}
