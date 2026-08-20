import { NextResponse } from "next/server";

import type createModule from "@jspawn/ghostscript-wasm/gs.js";
import type { GhostscriptModule } from "@jspawn/ghostscript-wasm/gs.js";

export const runtime = "nodejs";

const EPS_DPI = 150;
const EPS_TIMEOUT_MS = 120_000;

const BANNER_PREFIXES = [
  "GPL Ghostscript",
  "Copyright",
  "This software is supplied",
  "see the file COPYING",
];

let gsFactoryPromise: Promise<typeof createModule> | null = null;

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
          "The Ghostscript renderer could not be loaded on the server."
        );
      }
      return factory;
    })();
  }
  return gsFactoryPromise;
}

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

async function convertEpsToPng(
  file: File
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const factory = await loadGhostscriptFactory();

  let ghostscript: GhostscriptModule;
  try {
    ghostscript = await factory();
  } catch (error) {
    throw new Error(
      `Could not initialize the Ghostscript renderer. ${
        error instanceof Error ? error.message : ""
      }`
    );
  }

  const input = "input.eps";
  const output = "output.png";

  const bytes = new Uint8Array(await file.arrayBuffer());
  ghostscript.FS.writeFile(input, bytes);

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
    exitCode = ghostscript.callMain(args);
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
    pngBytes = ghostscript.FS.readFile(output, { encoding: "binary" });
  } finally {
    try {
      ghostscript.FS.unlink(input);
    } catch {
      // Ignore cleanup errors.
    }
    try {
      ghostscript.FS.unlink(output);
    } catch {
      // Ignore cleanup errors.
    }
  }

  if (!pngBytes.length) {
    throw new Error("Ghostscript produced no output for the EPS file.");
  }

  return { bytes: pngBytes, mimeType: "image/png" };
}

export async function POST(request: Request): Promise<NextResponse> {
  let file: File | null = null;
  try {
    const formData = await request.formData();
    file = formData.get("file") as File | null;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid form data." },
      { status: 400 }
    );
  }

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "No EPS file provided." },
      { status: 400 }
    );
  }

  const MAX_EPS_BYTES = 50 * 1024 * 1024;
  if (file.size > MAX_EPS_BYTES) {
    return NextResponse.json(
      { ok: false, error: "EPS file exceeds the 50 MB size limit." },
      { status: 413 }
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EPS_TIMEOUT_MS);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _signal = controller.signal;

    const result = await Promise.race([
      convertEpsToPng(file),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          controller.abort();
          reject(new Error("EPS conversion timed out after 2 minutes."));
        }, EPS_TIMEOUT_MS);
      }),
    ]);

    clearTimeout(timeout);

    const body = new Uint8Array(result.bytes);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Content-Length": String(body.length),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "EPS conversion failed.";
    console.error("[API /convert-eps]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, service: "convert-eps" });
}
