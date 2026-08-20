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

export type PreparedEntry = { dataUrl: string; mimeType: string };
export type PreparedBlobEntry = { blob: Blob; mimeType: string };

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

  // Deferred base64: a compressed Blob was stored during upload. Convert it
  // to a data URL once on demand and cache the result.
  if (
    image.apiBlob &&
    image.apiMimeType &&
    maxDimension === ANALYSIS_MAX_DIMENSION
  ) {
    try {
      const dataUrl = await blobToDataUrl(image.apiBlob);
      const base64 = dataUrl.split(",")[1] ?? "";
      if (base64.length > 0) {
        const entry = { dataUrl, mimeType: image.apiMimeType };
        preparedCache.set(cacheKey, entry);
        useAppStore.getState().updateImage(image.id, {
          apiDataUrl: dataUrl,
          apiMimeType: image.apiMimeType,
        });
        return entry;
      }
      console.warn(
        "[Image] apiBlob produced empty data URL, re-compressing from source blob",
        image.name
      );
    } catch (error) {
      console.warn("[Image] blobToDataUrl failed, re-compressing from source blob", error);
    }
  }

  try {
    let compressed: PreparedEntry;
    if (image.blob) {
      compressed = await preparedImageFromBlob(image.blob, { maxDimension });
    } else if (image.dataUrl) {
      compressed = await compressImageDataUrl(
        image.dataUrl,
        IMAGE_MAX_BYTES,
        maxDimension
      );
    } else {
      throw new Error("The image has no readable source for analysis.");
    }
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
    return {
      dataUrl: image.apiDataUrl ?? image.dataUrl ?? "",
      mimeType: image.apiMimeType ?? image.type,
    };
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

type BitmapSource = ImageBitmap | HTMLImageElement;

function closeBitmap(image: BitmapSource): void {
  if (typeof (image as ImageBitmap).close === "function") {
    try {
      (image as ImageBitmap).close();
    } catch {
      // Ignore bitmap teardown errors.
    }
  }
}

// Decode a Blob into a drawable image. createImageBitmap is preferred (fast,
// off-main-thread capable); some formats (e.g. SVG) require the img element
// on the main thread.
async function loadBitmap(blob: Blob): Promise<BitmapSource> {
  try {
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width > 0 && bitmap.height > 0) return bitmap;
    closeBitmap(bitmap);
  } catch {
    // Fall through to the img-element loader below.
  }
  if (IS_WORKER) {
    throw new Error("This file type cannot be decoded for analysis.");
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(blob)
      : "";
    const img = new Image();
    img.onload = () => {
      if (url) URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (url) URL.revokeObjectURL(url);
      reject(new Error("Could not read the image for compression."));
    };
    img.src = url;
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

function hasMeaningfulTransparency(image: BitmapSource): boolean {
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

function encodeBlobFromBitmap(
  image: BitmapSource,
  opts: {
    targetMaxBytes: number;
    maxDimension?: number;
    preserveAlpha?: boolean;
  }
): Promise<PreparedBlobEntry> {
  const maxDimension = opts.maxDimension ?? ANALYSIS_MAX_DIMENSION;
  const targetMaxBytes = opts.targetMaxBytes;
  const preserveAlpha = opts.preserveAlpha !== false;

  // Never upscale: start from the original size capped at maxDimension.
  const largest = Math.max(image.width, image.height);
  let dimension = Math.min(maxDimension, largest);
  const transparent = preserveAlpha && hasMeaningfulTransparency(image);

  const attempt = async (): Promise<PreparedBlobEntry | null> => {
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

    if (transparent) {
      const png = await canvasToBlob(canvas, "image/png", QUALITY_STEPS[0]);
      if (png && png.size <= targetMaxBytes) {
        return { blob: png, mimeType: "image/png" };
      }
      for (const quality of QUALITY_STEPS) {
        const webp = await canvasToBlob(canvas, "image/webp", quality);
        if (webp && webp.size <= targetMaxBytes) {
          return { blob: webp, mimeType: "image/webp" };
        }
      }
    } else {
      for (const quality of QUALITY_STEPS) {
        const blob = await canvasToBlob(canvas, "image/jpeg", quality);
        if (blob && blob.size <= targetMaxBytes) {
          return { blob, mimeType: "image/jpeg" };
        }
      }
    }
    return null;
  };

  const stepDown = (): number | null => {
    if (dimension <= MIN_DIMENSION) return null;
    const next = Math.max(MIN_DIMENSION, Math.round(dimension * 0.75));
    if (next >= dimension) return null;
    dimension = next;
    return dimension;
  };

  return (async () => {
    for (;;) {
      const entry = await attempt();
      if (entry) return entry;
      if (stepDown() === null) throw new ImageTooLargeError();
    }
  })();
}

function encodeFromBitmap(
  image: BitmapSource,
  opts: {
    targetMaxBytes: number;
    maxDimension?: number;
    preserveAlpha?: boolean;
  }
): Promise<PreparedEntry> {
  return encodeBlobFromBitmap(image, opts).then(async (entry) => ({
    dataUrl: await blobToDataUrl(entry.blob),
    mimeType: entry.mimeType,
  }));
}

// Build a small, AI-ready analysis image straight from a Blob — no full-size
// base64 intermediate is ever produced.
export async function preparedImageFromBlob(
  blob: Blob,
  opts: { maxDimension?: number; targetMaxBytes?: number } = {}
): Promise<PreparedEntry> {
  const image = await loadBitmap(blob);
  try {
    return await encodeFromBitmap(image, {
      maxDimension: opts.maxDimension ?? ANALYSIS_MAX_DIMENSION,
      targetMaxBytes: opts.targetMaxBytes ?? IMAGE_MAX_BYTES,
    });
  } finally {
    closeBitmap(image);
  }
}

// Like preparedImageFromBlob but returns a Blob instead of a base64 data URL.
// The base64 conversion is deferred to generation time, keeping upload fast.
export async function prepareCompressedBlob(
  blob: Blob,
  opts: { maxDimension?: number; targetMaxBytes?: number } = {}
): Promise<PreparedBlobEntry> {
  const image = await loadBitmap(blob);
  try {
    return await encodeBlobFromBitmap(image, {
      maxDimension: opts.maxDimension ?? ANALYSIS_MAX_DIMENSION,
      targetMaxBytes: opts.targetMaxBytes ?? IMAGE_MAX_BYTES,
    });
  } finally {
    closeBitmap(image);
  }
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
  try {
    return await encodeFromBitmap(image, {
      targetMaxBytes,
      maxDimension,
      preserveAlpha: opts.preserveAlpha,
    });
  } finally {
    closeBitmap(image);
  }
}
