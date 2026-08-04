import type { CsvFormat, GenerationResult, StockMetadata } from "@/lib/types";
import {
  CSV_MAX_ROWS,
  FILENAME_MAX,
  SHUTTERSTOCK_KEYWORDS_MAX,
  SHUTTERSTOCK_KEYWORDS_MIN,
  SHUTTERSTOCK_TITLE_MAX,
  normalizeShutterstockCategories,
} from "@/lib/stock-spec";

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

function uniqueKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const keyword of keywords) {
    const clean = keyword.trim();
    if (!clean || clean.includes(",")) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

const SHUTTERSTOCK_STOPWORDS = new Set([
  "the",
  "and",
  "with",
  "from",
  "into",
  "over",
  "under",
  "this",
  "that",
  "they",
  "them",
  "their",
  "there",
  "these",
  "those",
  "have",
  "were",
  "with",
  "aerial",
  "view",
]);

function wordsFrom(text: string): string[] {
  return text
    .split(/[^A-Za-z0-9'’-]+/)
    .map((word) => word.trim().toLowerCase())
    .filter(
      (word) => word.length >= 3 && !SHUTTERSTOCK_STOPWORDS.has(word)
    );
}

function fitShutterstockDescription(value: string): string {
  const text = value.trim();
  if (!text) return "Stock photo.";
  if (text.length <= SHUTTERSTOCK_TITLE_MAX) return text;
  const words = text.split(/\s+/);
  let result = "";
  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (next.length > SHUTTERSTOCK_TITLE_MAX) break;
    result = next;
  }
  return result;
}

const SHUTTERSTOCK_FALLBACK_KEYWORDS = [
  "photo",
  "image",
  "picture",
  "stock",
  "background",
  "scene",
  "subject",
];

export function fixShutterstockMetadata(meta: StockMetadata): StockMetadata {
  const description = fitShutterstockDescription(meta.description || meta.title);
  const category = normalizeShutterstockCategories(meta.category).join(", ");

  let keywords = uniqueKeywords(meta.keywords);
  if (keywords.length > SHUTTERSTOCK_KEYWORDS_MAX)
    keywords = keywords.slice(0, SHUTTERSTOCK_KEYWORDS_MAX);

  const seen = new Set(keywords.map((keyword) => keyword.toLowerCase()));
  if (keywords.length < SHUTTERSTOCK_KEYWORDS_MIN) {
    const pool = [...wordsFrom(description), ...wordsFrom(meta.title), ...keywords];
    for (const word of pool) {
      if (keywords.length >= SHUTTERSTOCK_KEYWORDS_MIN) break;
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      keywords.push(word);
    }
  }
  for (const keyword of SHUTTERSTOCK_FALLBACK_KEYWORDS) {
    if (keywords.length >= SHUTTERSTOCK_KEYWORDS_MIN) break;
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    keywords.push(keyword);
  }

  return {
    title: meta.title.trim() || description,
    description,
    keywords,
    category,
  };
}

function shutterstockRows(
  results: GenerationResult[],
  filenames: ResolvedFilename[]
) {
  return results.map((result, index) => {
    const meta = fixShutterstockMetadata(result.metadata.shutterstock);
    return {
      Filename: filenames[index].name,
      Description: meta.description,
      Keywords: meta.keywords.join(", "),
      Categories: meta.category,
      Illustration: "No",
      "Mature Content": "No",
      Editorial: "No",
    };
  });
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
