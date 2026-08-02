import type { CsvFormat, GenerationResult } from "@/lib/types";
import { CSV_MAX_ROWS, FILENAME_MAX } from "@/lib/stock-spec";

export type ResolvedFilename = {
  original: string;
  name: string;
  shortened: boolean;
};

function splitExtension(filename: string): { base: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return { base: filename, ext: "" };
  return { base: filename.slice(0, dot), ext: filename.slice(dot) };
}

function fitFilename(
  base: string,
  ext: string,
  maxLength: number | null,
  suffix: string
): string {
  if (maxLength === null) return `${base}${suffix}${ext}`;
  const tail = `${suffix}${ext}`;
  const maxBase = Math.max(0, maxLength - tail.length);
  const fitBase = base.length > maxBase ? base.slice(0, maxBase) : base;
  return `${fitBase}${tail}`;
}

export function resolveExportFilenames(
  results: GenerationResult[],
  format: CsvFormat
): ResolvedFilename[] {
  const maxLength = format === "adobe" ? FILENAME_MAX : null;
  const used = new Set<string>();
  return results.map((result) => {
    const original = result.imageName.trim() || "file";
    const { base, ext } = splitExtension(original);
    let name = fitFilename(base, ext, maxLength, "");
    let counter = 2;
    while (used.has(name)) {
      name = fitFilename(base, ext, maxLength, `-${counter}`);
      counter++;
    }
    used.add(name);
    return { original, name, shortened: name !== original };
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function encodeCsv(csv: string): Blob {
  return new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;header=present",
  });
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

type PapaModule = typeof import("papaparse");

async function getPapa(): Promise<PapaModule> {
  return (await import("papaparse")).default;
}

export const ADOBE_FIELDS = ["Filename", "Title", "Keywords", "Category", "Releases"];

export const SHUTTERSTOCK_FIELDS = [
  "Filename",
  "Description",
  "Keywords",
  "Categories",
  "Illustration",
  "Mature Content",
  "Editorial",
];

function assertRowLimit(results: GenerationResult[]) {
  if (results.length > CSV_MAX_ROWS) {
    throw new Error(
      `A maximum of ${CSV_MAX_ROWS} rows is allowed per CSV file.`
    );
  }
}

function adobeRows(
  results: GenerationResult[],
  releases: string,
  filenames: ResolvedFilename[]
) {
  return results.map((result, index) => ({
    Filename: filenames[index].name,
    Title: result.metadata.adobe.title,
    Keywords: result.metadata.adobe.keywords.join(", "),
    Category: result.metadata.adobe.category,
    Releases: releases,
  }));
}

function shutterstockRows(
  results: GenerationResult[],
  filenames: ResolvedFilename[]
) {
  return results.map((result, index) => ({
    Filename: filenames[index].name,
    Description: result.metadata.shutterstock.description,
    Keywords: result.metadata.shutterstock.keywords.join(", "),
    Categories: result.metadata.shutterstock.category,
    Illustration: "No",
    "Mature Content": "No",
    Editorial: "No",
  }));
}

export async function exportAdobeCsv(
  results: GenerationResult[],
  releases = "No"
): Promise<void> {
  assertRowLimit(results);
  const filenames = resolveExportFilenames(results, "adobe");
  const Papa = await getPapa();
  const csv = Papa.unparse({
    fields: ADOBE_FIELDS,
    data: adobeRows(results, releases, filenames),
  });
  downloadBlob(encodeCsv(csv), `adobe-stock-${dateStamp()}.csv`);
}

export async function exportShutterstockCsv(
  results: GenerationResult[]
): Promise<void> {
  assertRowLimit(results);
  const filenames = resolveExportFilenames(results, "shutterstock");
  const Papa = await getPapa();
  const csv = Papa.unparse({
    fields: SHUTTERSTOCK_FIELDS,
    data: shutterstockRows(results, filenames),
  });
  downloadBlob(encodeCsv(csv), `shutterstock-${dateStamp()}.csv`);
}

export function formatHint(format: CsvFormat): string {
  return format === "adobe"
    ? "Columns: Filename, Title, Keywords, Category, Releases"
    : "Columns: Filename, Description, Keywords, Categories, Illustration, Mature Content, Editorial";
}
