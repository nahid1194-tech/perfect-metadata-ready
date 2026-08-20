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
      new URL("../workers/eps-convert.worker.ts", import.meta.url)
    );
    worker.addEventListener("message", (event) => {
      const msg = event.data as {
        id: number;
        ok: boolean;
        pngBytes?: ArrayBuffer;
        mimeType?: string;
        error?: string;
      };
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (!msg.ok) {
        p.reject(new Error(msg.error ?? "EPS conversion failed."));
      } else if (msg.pngBytes && msg.mimeType) {
        const blob = new Blob([msg.pngBytes], { type: msg.mimeType });
        p.resolve({ blob, mimeType: msg.mimeType });
      } else {
        p.reject(new Error("Worker returned empty result."));
      }
    });
    worker.addEventListener("error", (event) => {
      console.error("[EPS Worker] error", event);
      for (const p of pending.values()) {
        p.reject(new Error("EPS conversion worker crashed."));
      }
      pending.clear();
      worker = null;
    });
    return worker;
  } catch {
    return null;
  }
}

export async function convertEpsViaWorker(
  file: File
): Promise<{ blob: Blob; mimeType: string }> {
  const w = ensureWorker();
  if (!w) {
    throw new Error(
      "EPS conversion worker could not be started."
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const id = requestId++;

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage(
      { id, fileBytes: arrayBuffer, fileName: file.name },
      [arrayBuffer]
    );
  });
}

export function terminateEpsWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const p of pending.values()) {
    p.reject(new Error("EPS conversion worker terminated."));
  }
  pending.clear();
}
