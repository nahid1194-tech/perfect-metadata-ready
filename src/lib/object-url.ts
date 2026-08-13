export function createObjectUrl(blob: Blob): string {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return URL.createObjectURL(blob);
  }
  return "";
}

export function revokeObjectUrl(url?: string): void {
  if (!url) return;
  try {
    if (
      typeof URL !== "undefined" &&
      typeof URL.revokeObjectURL === "function"
    ) {
      URL.revokeObjectURL(url);
    }
  } catch {
    // Revocation is best-effort.
  }
}

type ObjectUrlAsset = {
  previewUrl?: string;
  dataUrl?: string;
};

export function revokeAssetUrls(asset: ObjectUrlAsset): void {
  revokeObjectUrl(asset.previewUrl);
  revokeObjectUrl(asset.dataUrl);
}

