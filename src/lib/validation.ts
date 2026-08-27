import type { CsvFormat, GenerationResult, MagnificMetadata, StockMetadata } from "@/lib/types";
import {
  ADOBE_KEYWORDS_MAX,
  ADOBE_TITLE_MAX,
  MAGNIFIC_KEYWORDS_MAX,
  MAGNIFIC_TITLE_MAX,
  SHUTTERSTOCK_KEYWORDS_MAX,
  SHUTTERSTOCK_KEYWORDS_MIN,
  SHUTTERSTOCK_TITLE_MAX,
  isValidAdobeCategory,
  isValidShutterstockCategories,
} from "@/lib/stock-spec";

export type ValidationError = {
  filename: string;
  issues: string[];
};

function validateAdobe(meta: StockMetadata): string[] {
  const issues: string[] = [];
  if (!meta.title.trim()) {
    issues.push("Title is required");
  } else {
    if (meta.title.length > ADOBE_TITLE_MAX)
      issues.push(`Title must be ${ADOBE_TITLE_MAX} characters or fewer`);
    if (meta.title.includes(","))
      issues.push("Title cannot contain commas");
  }
  if (meta.keywords.length === 0) {
    issues.push("At least one keyword is required");
  } else if (meta.keywords.length > ADOBE_KEYWORDS_MAX) {
    issues.push(
      `Maximum ${ADOBE_KEYWORDS_MAX} keywords allowed (${meta.keywords.length})`
    );
  }
  if (meta.keywords.some((keyword) => keyword.includes(",")))
    issues.push("Keywords cannot contain commas");
  if (!isValidAdobeCategory(meta.category))
    issues.push("Select a valid Adobe category (number 1-21)");
  return issues;
}

function validateShutterstock(meta: StockMetadata): string[] {
  const issues: string[] = [];
  if (!meta.description.trim()) {
    issues.push("Description is required");
  } else if (meta.description.length > SHUTTERSTOCK_TITLE_MAX) {
    issues.push(
      `Description must be ${SHUTTERSTOCK_TITLE_MAX} characters or fewer`
    );
  }
  if (meta.keywords.length === 0) {
    issues.push(`At least ${SHUTTERSTOCK_KEYWORDS_MIN} keywords are required`);
  } else if (meta.keywords.length < SHUTTERSTOCK_KEYWORDS_MIN) {
    issues.push(
      `Minimum ${SHUTTERSTOCK_KEYWORDS_MIN} keywords required (${meta.keywords.length})`
    );
  } else if (meta.keywords.length > SHUTTERSTOCK_KEYWORDS_MAX) {
    issues.push(
      `Maximum ${SHUTTERSTOCK_KEYWORDS_MAX} keywords allowed (${meta.keywords.length})`
    );
  }
  if (meta.keywords.some((keyword) => keyword.includes(",")))
    issues.push("Keywords cannot contain commas");
  if (!isValidShutterstockCategories(meta.category))
    issues.push("Select 1 or 2 valid Shutterstock categories");
  return issues;
}

function validateMagnific(meta: MagnificMetadata): string[] {
  const issues: string[] = [];
  if (!meta.title.trim()) {
    issues.push("Title is required");
  } else if (meta.title.length > MAGNIFIC_TITLE_MAX) {
    issues.push(
      `Title must be ${MAGNIFIC_TITLE_MAX} characters or fewer`
    );
  }
  if (meta.keywords.length === 0) {
    issues.push("At least one keyword is required");
  } else if (meta.keywords.length > MAGNIFIC_KEYWORDS_MAX) {
    issues.push(
      `Maximum ${MAGNIFIC_KEYWORDS_MAX} keywords allowed (${meta.keywords.length})`
    );
  }
  if (meta.keywords.some((keyword) => keyword.includes(",")))
    issues.push("Keywords cannot contain commas");
  return issues;
}

export function validateMetadata(
  meta: StockMetadata | MagnificMetadata,
  format: CsvFormat
): string[] {
  if (format === "adobe") return validateAdobe(meta as StockMetadata);
  if (format === "shutterstock") return validateShutterstock(meta as StockMetadata);
  return validateMagnific(meta as MagnificMetadata);
}

export function validateResults(
  results: GenerationResult[],
  format: CsvFormat
): ValidationError[] {
  return results.flatMap((result) => {
    const issues = validateMetadata(result.metadata[format], format);
    if (issues.length === 0) return [];
    return [{ filename: result.imageName, issues }];
  });
}
