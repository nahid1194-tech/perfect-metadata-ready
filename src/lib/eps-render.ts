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

  const formData = new FormData();
  formData.append("file", file);

  let response: Response;
  try {
    response = await fetch("/api/convert-eps", {
      method: "POST",
      body: formData,
    });
  } catch (error) {
    throw new VectorConversionError(
      `Could not upload ${file.name} for conversion. ${
        error instanceof Error ? error.message : "Network error."
      }`
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: string };
      detail = body.error ?? "";
    } catch {
      // Response was not JSON.
    }
    throw new VectorConversionError(
      detail || `Server returned status ${response.status} during EPS conversion.`
    );
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new VectorConversionError(
      `Server produced an empty output for ${file.name}.`
    );
  }

  const result = { blob, mimeType: "image/png" };
  conversionCache.set(key, result);
  return result;
}

export function clearEpsConversionCache(): void {
  conversionCache.clear();
}
