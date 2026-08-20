import type createModule from "@jspawn/ghostscript-wasm/gs.js";
import type { GhostscriptModule } from "@jspawn/ghostscript-wasm/gs.js";

const GHOSTSCRIPT_WASM_URL = "/ghostscript/gs.wasm";
const EPS_DPI = 150;

type ConvertRequest = {
  id: number;
  fileBytes: ArrayBuffer;
  fileName: string;
};

type ConvertResponse =
  | { id: number; ok: true; pngBytes: ArrayBuffer | SharedArrayBuffer; mimeType: string }
  | { id: number; ok: false; error: string };

let gsFactoryPromise: Promise<typeof createModule> | null = null;
let activeGs: GhostscriptModule | null = null;

async function loadGhostscriptFactory(): Promise<typeof createModule> {
  if (!gsFactoryPromise) {
    gsFactoryPromise = (async () => {
      const mod = (await import("@jspawn/ghostscript-wasm/gs.js")) as {
        default?: typeof createModule;
        Module?: typeof createModule;
      };
      const factory = mod.default ?? mod.Module;
      if (!factory) {
        throw new Error(
          "The Ghostscript renderer could not be loaded in the worker."
        );
      }
      return factory;
    })();
  }
  return gsFactoryPromise;
}

async function ensureGhostscript(): Promise<GhostscriptModule> {
  if (activeGs) return activeGs;
  const factory = await loadGhostscriptFactory();
  activeGs = await factory({ locateFile: () => GHOSTSCRIPT_WASM_URL });
  return activeGs;
}

const BANNER_PREFIXES = [
  "GPL Ghostscript",
  "Copyright",
  "This software is supplied",
  "see the file COPYING",
];

function extractErrorDetail(stdout: string[], stderr: string[]): string {
  const filtered = stdout.filter((raw) => {
    const line = raw.trim();
    if (!line) return false;
    if (line.startsWith("Loading ") && line.includes(" font from ")) return false;
    return !BANNER_PREFIXES.some((prefix) => line.startsWith(prefix));
  });
  const headline = filtered[0]?.trim();
  const tail = stderr[stderr.length - 1]?.trim();
  const parts = [headline, tail && tail !== headline ? tail : undefined].filter(
    (part): part is string => Boolean(part)
  );
  return parts.join(" — ").slice(0, 400);
}

async function convertEps(
  fileBytes: ArrayBuffer,
  _fileName: string
): Promise<{ pngBytes: ArrayBuffer; mimeType: string }> {
  const gs = await ensureGhostscript();

  const ext = _fileName.endsWith(".ps") ? "ps" : "eps";
  const input = `input.${ext}`;
  const output = "output.png";

  const bytes = new Uint8Array(fileBytes);
  gs.FS.writeFile(input, bytes);

  const args = [
    "-dSAFER",
    "-dBATCH",
    "-dNOPAUSE",
    "-dEPSCrop",
    "-sDEVICE=png16m",
    `-r${EPS_DPI}`,
    "-dTextAlphaBits=4",
    "-dGraphicsAlphaBits=4",
    `-sOutputFile=${output}`,
    input,
  ];

  const stdout: string[] = [];
  const stderr: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = (...a: unknown[]) => stdout.push(a.map(String).join(" "));
  console.warn = (a?: unknown) => stderr.push(String(a));
  console.error = (a?: unknown) => stderr.push(String(a));

  let exitCode: number;
  try {
    exitCode = gs.callMain(args);
  } catch (error) {
    throw new Error(
      `Ghostscript could not convert the file. ${
        extractErrorDetail(stdout, stderr) ||
        (error instanceof Error ? error.message : "unknown error")
      }`
    );
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }

  if (exitCode !== 0) {
    throw new Error(
      `Could not convert the EPS file. ${
        extractErrorDetail(stdout, stderr) ||
        `Ghostscript exited with code ${exitCode}.`
      }`
    );
  }

  let pngBytes: Uint8Array;
  try {
    pngBytes = gs.FS.readFile(output, { encoding: "binary" });
  } finally {
    try {
      gs.FS.unlink(input);
    } catch {
      // Ignore cleanup errors.
    }
    try {
      gs.FS.unlink(output);
    } catch {
      // Ignore cleanup errors.
    }
  }

  if (!pngBytes.length) {
    throw new Error("Ghostscript produced no output for the EPS file.");
  }

  const copied = new ArrayBuffer(pngBytes.byteLength);
  new Uint8Array(copied).set(pngBytes);

  return {
    pngBytes: copied,
    mimeType: "image/png",
  };
}

self.addEventListener("message", async (event: MessageEvent<ConvertRequest>) => {
  const { id, fileBytes, fileName } = event.data;
  try {
    const result = await convertEps(fileBytes, fileName);
    const response: ConvertResponse = {
      id,
      ok: true,
      pngBytes: result.pngBytes,
      mimeType: result.mimeType,
    };
    self.postMessage(response);
  } catch (error) {
    const response: ConvertResponse = {
      id,
      ok: false,
      error:
        error instanceof Error ? error.message : "EPS conversion failed.",
    };
    self.postMessage(response);
  }
});
