import type { ContentIssue, ImageAsset } from "@/lib/types";

type HashPair = { aHash: string; dHash: string };

const hashCache = new Map<string, Promise<HashPair>>();

function kindOf(source: ImageBitmap | HTMLImageElement): string {
  return typeof (source as HTMLImageElement).src === "string"
    ? "img"
    : "bitmap";
}

function disposeSource(source: ImageBitmap | HTMLImageElement): void {
  try {
    if (kindOf(source) === "bitmap") (source as ImageBitmap).close();
  } catch {
    // Ignore bitmap teardown errors.
  }
}

async function decodeSource(src: string | Blob): Promise<
  ImageBitmap | HTMLImageElement
> {
  const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
  try {
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width > 0 && bitmap.height > 0) return bitmap;
    (bitmap as ImageBitmap).close();
  } catch {
    // Fall through to the <img> loader below.
  }
  const url = typeof URL.createObjectURL === "function"
    ? URL.createObjectURL(blob)
    : "";
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (url) URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (url) URL.revokeObjectURL(url);
      reject(new Error("Could not decode this image for the similarity check."));
    };
    img.src = url;
  });
}

export async function perceptualHashes(src: string | Blob): Promise<HashPair> {
  const source = await decodeSource(src);
  try {
    const width = 8;
    const height = 8;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas is unavailable for similarity checks.");
    ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const gray = new Array<number>(width * height);
    for (let i = 0; i < gray.length; i++) {
      gray[i] =
        data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    }
    let aHash = "";
    let sum = 0;
    for (const value of gray) sum += value;
    const average = sum / gray.length;
    for (const value of gray) aHash += value >= average ? "1" : "0";
    let dHash = "";
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width - 1; x++) {
        dHash +=
          gray[y * width + x] >= gray[y * width + x + 1] ? "1" : "0";
      }
    }
    return { aHash, dHash };
  } finally {
    disposeSource(source);
  }
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) distance++;
  }
  return distance;
}

function similarityScore(a: HashPair, b: HashPair): number {
  return Math.min(
    hammingDistance(a.aHash, b.aHash),
    hammingDistance(a.dHash, b.dHash)
  );
}

function similarityReason(
  severity: string,
  otherName: string
): string {
  if (severity === "HIGH") {
    return `Duplicate or near-identical to "${otherName}" — similar content/spam risk.`;
  }
  if (severity === "MEDIUM") {
    return `Very similar to "${otherName}" — verify it is sufficiently distinct.`;
  }
  return `Similar composition to "${otherName}" — minor variations detected.`;
}

function analysisSource(image: ImageAsset): string | Blob | null {
  if (image.apiDataUrl) return image.apiDataUrl;
  if (image.apiBlob) return image.apiBlob;
  if (image.blob) return image.blob;
  if (image.dataUrl?.startsWith("data:")) return image.dataUrl;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function analyzeSimilarity(
  images: ImageAsset[],
  opts: { concurrency?: number } = {}
): Promise<Record<string, ContentIssue[]>> {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const candidates = images
    .map((image) => ({ image, src: analysisSource(image) }))
    .filter((entry): entry is { image: ImageAsset; src: string | Blob } =>
      Boolean(entry.src)
    );

  const hashes = new Map<string, HashPair>();
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++;
      if (index >= candidates.length) return;
      const { image, src } = candidates[index];
      const cached = hashCache.get(image.id);
      const promise = cached ?? perceptualHashes(src);
      hashCache.set(image.id, promise);
      try {
        hashes.set(image.id, await promise);
      } catch {
        // A single unreadable asset must not abort the whole scan.
      }
      await sleep(0);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, candidates.length) },
      () => worker()
    )
  );

  const issues: Record<string, ContentIssue[]> = {};
  const nameByImage = new Map(images.map((image) => [image.id, image.name]));
  const ids = candidates
    .map((entry) => entry.image.id)
    .filter((id) => hashes.has(id));

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const firstId = ids[i];
      const secondId = ids[j];
      const first = hashes.get(firstId);
      const second = hashes.get(secondId);
      if (!first || !second) continue;
      const distance = similarityScore(first, second);
      let severity: "LOW" | "MEDIUM" | "HIGH";
      if (distance <= 2) severity = "HIGH";
      else if (distance <= 7) severity = "MEDIUM";
      else if (distance <= 12) severity = "LOW";
      else continue;
      const list = issues;
      const aReason = similarityReason(severity, nameByImage.get(secondId) ?? "another asset");
      const bReason = similarityReason(severity, nameByImage.get(firstId) ?? "another asset");
      if (!list[firstId]) list[firstId] = [];
      list[firstId].push({ category: "SIMILARITY", severity, reason: aReason });
      if (!list[secondId]) list[secondId] = [];
      list[secondId].push({ category: "SIMILARITY", severity, reason: bReason });
    }
  }

  return issues;
}

export async function vectorStructureIssues(
  image: ImageAsset
): Promise<ContentIssue[]> {
  if (!/\.(eps|ps)$/i.test(image.name) && !/\.svg$/i.test(image.name)) {
    return [];
  }
  const source = image.apiBlob ?? image.blob ?? null;
  if (/\.svg$/i.test(image.name) && source) {
    try {
      const text = await source.text();
      if (
        /<image[^>]*>/i.test(text) ||
        /data:image\/(png|jpe?g|gif|webp|bmp);base64/i.test(text)
      ) {
        return [
          {
            category: "VECTOR",
            severity: "MEDIUM",
            reason:
              "SVG contains embedded raster/pixel-based image data — Adobe vectors should not embed pixel-based images.",
          },
        ];
      }
    } catch {
      // Fall through to the honest "could not be fully verified" note.
    }
  }
  return [
    {
      category: "VECTOR",
      severity: "MEDIUM",
      reason: "Vector structure could not be fully verified.",
    },
  ];
}