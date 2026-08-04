import type { ImageAsset } from "@/lib/types";
import { useAppStore } from "@/store/use-app-store";

export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;

export const IMAGE_API_MAX_DIMENSION = 1600;

const DEFAULT_MAX_DIMENSION = 4096;
const MIN_QUALITY = 0.3;
const MIN_DIMENSION = 1024;

const preparedCache = new Map<string, { dataUrl: string; mimeType: string }>();

export async function prepareImageForApi(
  image: ImageAsset
): Promise<{ dataUrl: string; mimeType: string }> {
  const cached = preparedCache.get(image.id);
  if (cached) return cached;
  if (image.apiDataUrl && image.apiMimeType) {
    const entry = { dataUrl: image.apiDataUrl, mimeType: image.apiMimeType };
    preparedCache.set(image.id, entry);
    return entry;
  }
  try {
    const compressed = await compressImageDataUrl(
      image.dataUrl,
      IMAGE_MAX_BYTES,
      IMAGE_API_MAX_DIMENSION
    );
    preparedCache.set(image.id, compressed);
    useAppStore.getState().updateImage(image.id, {
      apiDataUrl: compressed.dataUrl,
      apiMimeType: compressed.mimeType,
    });
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("Could not read the image for compression."));
    img.src = src;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
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

export async function compressImageDataUrl(
  dataUrl: string,
  targetMaxBytes: number,
  maxDimension = DEFAULT_MAX_DIMENSION
): Promise<{ dataUrl: string; mimeType: string }> {
  const image = await loadImage(dataUrl);
  if (!image.width || !image.height) {
    throw new Error("The image could not be loaded for compression.");
  }

  const largest = Math.max(image.width, image.height);
  let dimension = Math.min(maxDimension, largest);
  let quality = 0.8;

  for (;;) {
    const scale = dimension / largest;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not initialize image compression.");
    ctx.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (blob && blob.size <= targetMaxBytes) {
      return { dataUrl: await blobToDataUrl(blob), mimeType: "image/jpeg" };
    }

    if (quality > MIN_QUALITY) {
      quality -= 0.1;
      continue;
    }
    if (dimension > MIN_DIMENSION) {
      dimension = Math.max(MIN_DIMENSION, Math.floor(dimension / 2));
      quality = 0.8;
      continue;
    }
    throw new ImageTooLargeError();
  }
}
