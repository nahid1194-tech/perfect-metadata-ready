import type { GenerationSettings, ImageAsset } from "@/lib/types";

function settingsSignature(settings: GenerationSettings): string {
  const pick = {
    titleLength: settings.titleLength,
    descriptionLength: settings.descriptionLength,
    keywordCount: settings.keywordCount,
    prefix: settings.enablePrefix ? settings.prefix : "",
    suffix: settings.enableSuffix ? settings.suffix : "",
    negativeTitleWords: settings.enableNegativeTitleWords
      ? settings.negativeTitleWords
      : "",
    negativeKeywords: settings.enableNegativeKeywords
      ? settings.negativeKeywords
      : "",
  };
  return JSON.stringify(pick);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    let hash = 2166136261;
    for (const byte of data) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
  const digest = await subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function resultCacheKey(
  image: ImageAsset,
  settings: GenerationSettings
): Promise<string> {
  const source = image.apiDataUrl ?? image.dataUrl;
  const base64 = source.split(",")[1] ?? source;
  const content = await sha256Hex(base64ToBytes(base64));
  return `${content}:${settingsSignature(settings)}`;
}
