import type createModule from "@jspawn/ghostscript-wasm/gs.js";
import type { GhostscriptModule } from "@jspawn/ghostscript-wasm/gs.js";

const GHOSTSCRIPT_WASM_URL = "/ghostscript/gs.wasm";

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

type GhostscriptFactory = typeof createModule;

let ghostscriptFactoryPromise: Promise<GhostscriptFactory> | null = null;

let originalLog: typeof console.log | null = null;
let originalWarn: typeof console.warn | null = null;
let originalError: typeof console.error | null = null;
let stdoutBuffer: string[] | null = null;
let stderrCapture: ((line: string) => void) | null = null;

function installConsoleInterceptors() {
  if (!originalLog) {
    originalLog = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      const line = args.map(String).join(" ");
      if (stdoutBuffer) stdoutBuffer.push(line);
      else originalLog!.apply(console, args);
    };
  }
  if (!originalWarn) {
    originalWarn = console.warn.bind(console);
    console.warn = (line?: unknown) => {
      if (stderrCapture) stderrCapture(String(line));
      else originalWarn!(line);
    };
  }
  if (!originalError) {
    originalError = console.error.bind(console);
    console.error = (line?: unknown) => {
      if (stderrCapture) stderrCapture(String(line));
      else originalError!(line);
    };
  }
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
    if (line.startsWith("Loading ") && line.includes(" font from ")) {
      return false;
    }
    return !BANNER_PREFIXES.some((prefix) => line.startsWith(prefix));
  });
  const headline = filtered[0]?.trim();
  const tail = stderr[stderr.length - 1]?.trim();
  const parts = [headline, tail && tail !== headline ? tail : undefined]
    .filter((part): part is string => Boolean(part));
  return parts.join(" — ").slice(0, 400);
}

async function loadGhostscriptFactory(): Promise<GhostscriptFactory> {
  installConsoleInterceptors();
  ghostscriptFactoryPromise ??= (async () => {
    const mod = (await import("@jspawn/ghostscript-wasm/gs.js")) as {
      default?: GhostscriptFactory;
      Module?: GhostscriptFactory;
    };
    const factory = mod.default ?? mod.Module;
    if (!factory) {
      throw new VectorConversionError(
        "The Ghostscript renderer could not be loaded."
      );
    }
    return factory;
  })();
  return ghostscriptFactoryPromise;
}

export async function renderVectorToPng(
  file: File
): Promise<{ blob: Blob; mimeType: string }> {
  const name = file.name;
  try {
    const factory = await loadGhostscriptFactory();

    let ghostscript: GhostscriptModule;
    try {
      ghostscript = await factory({ locateFile: () => GHOSTSCRIPT_WASM_URL });
    } catch (error) {
      throw new VectorConversionError(
        `Could not initialize the Ghostscript renderer. ${
          error instanceof Error ? error.message : ""
        }`
      );
    }

    const input = `input.${VECTOR_EXTENSION.test(name) ? "eps" : "ps"}`;
    const output = "output.png";

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      ghostscript.FS.writeFile(input, bytes);

      const args = [
        "-dSAFER",
        "-dBATCH",
        "-dNOPAUSE",
        "-dEPSCrop",
        "-sDEVICE=png16m",
        "-r300",
        "-dTextAlphaBits=4",
        "-dGraphicsAlphaBits=4",
        `-sOutputFile=${output}`,
        input,
      ];

      const stdout: string[] = [];
      const stderr: string[] = [];
      stdoutBuffer = stdout;
      stderrCapture = (line) => stderr.push(line);

      let exitCode: number;
      try {
        exitCode = ghostscript.callMain(args);
      } catch (error) {
        throw new VectorConversionError(
          `Ghostscript could not convert ${name}. ${
            extractErrorDetail(stdout, stderr) ||
            (error instanceof Error ? error.message : "unknown error")
          }`
        );
      }

      if (exitCode !== 0) {
        throw new VectorConversionError(
          `Could not convert ${name}. ${
            extractErrorDetail(stdout, stderr) ||
            `Ghostscript exited with code ${exitCode}.`
          }`
        );
      }

      const pngBytes = ghostscript.FS.readFile(output, { encoding: "binary" });
      if (!pngBytes.length) {
        throw new VectorConversionError(
          `Ghostscript produced no output for ${name}.`
        );
      }

      const blob = new Blob([pngBytes], { type: "image/png" });

      return { blob, mimeType: "image/png" };
    } finally {
      stdoutBuffer = null;
      stderrCapture = null;
      try {
        ghostscript.FS.unlink(input);
      } catch {
        // File was never created or already removed.
      }
      try {
        ghostscript.FS.unlink(output);
      } catch {
        // File was never created or already removed.
      }
    }
  } catch (error) {
    if (error instanceof VectorConversionError) throw error;
    throw new VectorConversionError(
      `Could not convert ${name}. ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }
}
