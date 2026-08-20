import { convertEpsViaWorker } from "@/lib/eps-worker-client";

const VECTOR_EXTENSION = /\.(eps|ps)$/i;

export function isVectorFile(file: { name: string }): boolean {
  return VECTOR_EXTENSION.test(file.name);
}

export class VectorConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorConversionError";
  }
}

const conversionCache = new Map<string, { blob: Blob; mimeType: string }>();

function fileCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export async function renderVectorToPng(
  file: File
): Promise<{ blob: Blob; mimeType: string }> {
  const key = fileCacheKey(file);
  const cached = conversionCache.get(key);
  if (cached) {
    return cached;
  }

  try {
    const result = await convertEpsViaWorker(file);
    if (!result.blob.size) {
      throw new VectorConversionError(
        `Conversion produced an empty output for ${file.name}.`
      );
    }
    conversionCache.set(key, result);
    return result;
  } catch (error) {
    if (error instanceof VectorConversionError) throw error;
    throw new VectorConversionError(
      `Could not convert ${file.name}. ${
        error instanceof Error ? error.message : "Unknown error."
      }`
    );
  }
}

export function clearEpsConversionCache(): void {
  conversionCache.clear();
}
