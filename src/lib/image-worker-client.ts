let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<
  number,
  {
    resolve: (data: { blob: Blob; mimeType: string }) => void;
    reject: (err: Error) => void;
  }
>();

function ensureWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(
      new URL("../workers/image-compress.worker.ts", import.meta.url),
    );
    worker.addEventListener("message", (event: MessageEvent) => {
      const msg = event.data;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error));
      } else {
        p.resolve({ blob: msg.compressedBlob, mimeType: msg.mimeType });
      }
    });
    worker.addEventListener("error", () => {
      for (const p of pending.values()) {
        p.reject(new Error("Image processing worker failed"));
      }
      pending.clear();
      worker = null;
    });
    return worker;
  } catch {
    return null;
  }
}

export function compressImageBlob(
  blob: Blob,
  opts: { maxDimension?: number; maxBytes?: number } = {},
): Promise<{ blob: Blob; mimeType: string }> | null {
  const w = ensureWorker();
  if (!w) return null;
  const id = requestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({
      id,
      blob,
      maxDimension: opts.maxDimension,
      maxBytes: opts.maxBytes,
    });
  });
}

export function terminateImageWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const p of pending.values()) {
    p.reject(new Error("Image processing worker terminated"));
  }
  pending.clear();
}
