const ANALYSIS_MAX_DIMENSION = 2048;
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const QUALITY_STEPS = [0.9, 0.86, 0.82];
const MIN_DIMENSION = 1024;

function hasMeaningfulTransparency(image: ImageBitmap): boolean {
  const maxDim = 64;
  const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
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

async function encodeFromBitmap(
  image: ImageBitmap,
  targetMaxBytes: number,
  maxDimension: number,
): Promise<{ blob: Blob; mimeType: string }> {
  const largest = Math.max(image.width, image.height);
  let dimension = Math.min(maxDimension, largest);
  const transparent = hasMeaningfulTransparency(image);

  for (;;) {
    const scale = dimension / largest;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create OffscreenCanvas context.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, width, height);

    if (transparent) {
      const png = await canvas.convertToBlob({
        type: "image/png",
        quality: QUALITY_STEPS[0],
      });
      if (png.size <= targetMaxBytes)
        return { blob: png, mimeType: "image/png" };
      for (const quality of QUALITY_STEPS) {
        const webp = await canvas.convertToBlob({
          type: "image/webp",
          quality,
        });
        if (webp.size <= targetMaxBytes)
          return { blob: webp, mimeType: "image/webp" };
      }
    } else {
      for (const quality of QUALITY_STEPS) {
        const blob = await canvas.convertToBlob({
          type: "image/jpeg",
          quality,
        });
        if (blob.size <= targetMaxBytes)
          return { blob, mimeType: "image/jpeg" };
      }
    }

    if (dimension <= MIN_DIMENSION) break;
    dimension = Math.max(MIN_DIMENSION, Math.round(dimension * 0.75));
  }

  throw new Error("Image is too large for analysis after compression.");
}

self.addEventListener(
  "message",
  async (
    event: MessageEvent<{
      id: number;
      blob: Blob;
      maxDimension?: number;
      maxBytes?: number;
    }>,
  ) => {
    const {
      id,
      blob,
      maxDimension = ANALYSIS_MAX_DIMENSION,
      maxBytes = IMAGE_MAX_BYTES,
    } = event.data;
    try {
      const bitmap = await createImageBitmap(blob);
      try {
        const result = await encodeFromBitmap(bitmap, maxBytes, maxDimension);
        self.postMessage({
          id,
          compressedBlob: result.blob,
          mimeType: result.mimeType,
        });
      } finally {
        bitmap.close();
      }
    } catch (error) {
      self.postMessage({
        id,
        error: error instanceof Error ? error.message : "Compression failed",
      });
    }
  },
);
