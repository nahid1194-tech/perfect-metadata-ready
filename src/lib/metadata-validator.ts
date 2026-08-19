import type {
  CsvFormat,
  GeneratedMetadata,
  GenerationSettings,
  StockMetadata,
  ValidationComponent,
  ValidationIssue,
  ValidationSeverity,
} from "@/lib/types";
import { rulesFor, resolveLimits } from "@/lib/marketplace-rules";
import {
  isValidAdobeCategory,
  isValidShutterstockCategories,
} from "@/lib/stock-spec";

export type ValidationReport = {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LONG_HASH_PATTERN = /\b[0-9a-f]{16,}\b/i;
const LONG_TIMESTAMP_PATTERN = /\b\d{13,}\b/;
const LONG_ALNUM_PATTERN = /\b(?=[a-z0-9]*\d)[a-z0-9]{12,}\b/i;
const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)[^\s]+\b|\b[\w-]+\.(?:com|net|org|io|co|info|me|biz|dev|ai)\b/i;
const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/;
const PHONE_PATTERN =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)|\d{1,4})[\s.-]?\d{2,4}[\s.-]?\d{3,4}/;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;
const NUMERIC_ONLY_PATTERN = /^\d+$/;
const COMPLETE_WORD_PATTERN = /^[a-z][a-z'’-]*$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(text: string, word: string): boolean {
  const escaped = escapeRegExp(word.toLowerCase());
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(
    text.toLowerCase()
  );
}

function findTerm(text: string, terms: string[]): string | null {
  for (const term of terms) {
    if (hasWord(text, term)) return term;
  }
  return null;
}

function findNearDuplicate(pairs: string[][]): string | null {
  for (const [a, b] of pairs) {
    if (a === b) continue;
    const roots = (value: string): string =>
      value
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9 ]/g, "")
        .replace(/\bs\b/g, "")
        .replace(/([^ ])s$/g, "$1")
        .trim();
    if (roots(a) === roots(b)) return `"${a}" and "${b}"`;

    const aLower = a.toLowerCase().trim();
    const bLower = b.toLowerCase().trim();
    const aWords = aLower.split(/\s+/);
    const bWords = bLower.split(/\s+/);
    if (
      aWords.length >= 1 &&
      bWords.length >= 1 &&
      (aLower.startsWith(bLower + " ") ||
        bLower.startsWith(aLower + " ") ||
        aLower.endsWith(" " + bLower) ||
        bLower.endsWith(" " + aLower))
    ) {
      return `"${a}" and "${b}"`;
    }
    const shorter = aWords.length <= bWords.length ? aWords : bWords;
    const longer = aWords.length <= bWords.length ? bWords : aWords;
    if (shorter.length < longer.length) {
      const shorterSet = new Set(shorter);
      const overlap = longer.filter((w) => shorterSet.has(w));
      if (overlap.length >= shorter.length * 0.5 && overlap.length > 0) {
        return `"${a}" and "${b}"`;
      }
    }
  }
  return null;
}

function issue(
  format: CsvFormat,
  component: ValidationComponent,
  severity: ValidationSeverity,
  message: string
): ValidationIssue {
  return { format, component, severity, message };
}

function validateText(
  format: CsvFormat,
  component: ValidationComponent,
  value: string,
  rules: ReturnType<typeof rulesFor>,
  errors: ValidationIssue[],
  warnings: ValidationIssue[]
): void {
  const lower = value.toLowerCase();
  if (UUID_PATTERN.test(lower) || LONG_HASH_PATTERN.test(lower) || LONG_TIMESTAMP_PATTERN.test(lower) || LONG_ALNUM_PATTERN.test(lower)) {
    errors.push(
      issue(format, component, "error", "Contains a filename fragment, UUID, hash, or random ID token")
    );
  }
  if (URL_PATTERN.test(lower)) {
    errors.push(
      issue(format, component, "error", "Contains a website URL or link")
    );
  }
  if (EMAIL_PATTERN.test(lower)) {
    errors.push(
      issue(format, component, "error", "Contains an email address")
    );
  }
  if (PHONE_PATTERN.test(lower) || SSN_PATTERN.test(lower)) {
    errors.push(
      issue(
        format,
        component,
        "error",
        "Contains a phone number or personal identifier"
      )
    );
  }
  const trademark = findTerm(value, rules.trademarkTerms);
  if (trademark) {
    errors.push(
      issue(
        format,
        component,
        "error",
        `May contain a trademark or brand name ("${trademark}")`
      )
    );
  }
  const camera = findTerm(value, rules.cameraTerms);
  if (camera) {
    errors.push(
      issue(
        format,
        component,
        "error",
        `May contain camera information ("${camera}")`
      )
    );
  }
  if (component !== "keywords") {
    const filler = findTerm(value, rules.titleFillerTerms);
    if (filler) {
      errors.push(
        issue(
          format,
          component,
          "error",
          `Contains generic filler or SEO spam ("${filler}")`
        )
      );
    }
  }
  void warnings;
}

function isFillerKeyword(
  keyword: string,
  rules: ReturnType<typeof rulesFor>
): string | null {
  const lower = keyword.toLowerCase().trim();
  for (const filler of rules.keywordFillerTerms) {
    if (lower === filler.toLowerCase()) return filler;
  }
  const multiWord = rules.keywordFillerTerms.filter(
    (term) => term.includes(" ")
  );
  for (const filler of multiWord) {
    if (lower.includes(filler.toLowerCase())) return filler;
  }
  return null;
}

function validateKeywords(
  format: CsvFormat,
  keywords: string[],
  rules: ReturnType<typeof rulesFor>,
  limits: ReturnType<typeof resolveLimits>,
  errors: ValidationIssue[],
  warnings: ValidationIssue[]
): void {
  const target = format === "adobe" ? limits.adobe.keywordCount : limits.shutterstock.keywordCount;
  if (keywords.length === 0) {
    errors.push(
      issue(format, "keywords", "error", "At least one keyword is required")
    );
    return;
  }
  if (keywords.length > rules.keywordMax) {
    errors.push(
      issue(
        format,
        "keywords",
        "error",
        `Exceeds the ${rules.keywordMax} keyword limit (${keywords.length})`
      )
    );
  }
  if (keywords.length < rules.keywordMin) {
    errors.push(
      issue(
        format,
        "keywords",
        "error",
        `Below the ${rules.keywordMin} keyword minimum (${keywords.length})`
      )
    );
  } else if (keywords.length !== target) {
    warnings.push(
      issue(
        format,
        "keywords",
        "warning",
        `Keyword count ${keywords.length} differs from the requested ${target}`
      )
    );
  }

  const seen = new Map<string, string>();
  const nearPairs: string[][] = [];
  const keywordsOnly = keywords.map((keyword) => keyword.trim());

  for (const keyword of keywordsOnly) {
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) {
      errors.push(
        issue(format, "keywords", "error", `Duplicate keyword "${keyword}"`)
      );
      continue;
    }
    for (const existing of seen.values()) {
      if (existing !== keyword) nearPairs.push([existing, keyword]);
    }
    seen.set(key, keyword);

    const words = keyword.split(/\s+/).filter(Boolean);
    if (words.length > rules.keywordMaxWords) {
      errors.push(
        issue(
          format,
          "keywords",
          "error",
          `Keyword "${keyword}" has more than ${rules.keywordMaxWords} words`
        )
      );
    }
    if (words.length === 2 && format === "adobe") {
      const shorterCandidate = words[0];
      const isRedundant = seen.has(shorterCandidate.toLowerCase());
      if (!isRedundant) {
        warnings.push(
          issue(
            format,
            "keywords",
            "warning",
            `Keyword "${keyword}" is two words; prefer the single-word form "${shorterCandidate}" if it captures the same meaning`
          )
        );
      }
    }
    if (NUMERIC_ONLY_PATTERN.test(keyword)) {
      errors.push(
        issue(format, "keywords", "error", `Keyword "${keyword}" is only a number`)
      );
    }
    const filler = isFillerKeyword(keyword, rules);
    if (filler) {
      errors.push(
        issue(
          format,
          "keywords",
          "error",
          `Keyword "${keyword}" is generic filler or SEO spam`
        )
      );
    }
    if (words.length === 1 && keyword.length === 1) {
      errors.push(
        issue(
          format,
          "keywords",
          "error",
          `Keyword "${keyword}" looks like an incomplete word`
        )
      );
    }
    if (keyword.endsWith("-") || keyword.endsWith(".")) {
      errors.push(
        issue(
          format,
          "keywords",
          "error",
          `Keyword "${keyword}" is incomplete (trailing "${keyword.slice(-1)}")`
        )
      );
    }
    for (const word of words) {
      if (/^[a-z]/i.test(word) && word.length > 1 && !COMPLETE_WORD_PATTERN.test(word)) {
        errors.push(
          issue(
            format,
            "keywords",
            "error",
            `Keyword "${keyword}" contains an incomplete or nonsensical word`
          )
        );
        break;
      }
    }
  }

  const nearDuplicate = findNearDuplicate(nearPairs);
  if (nearDuplicate) {
    warnings.push(
      issue(
        format,
        "keywords",
        "warning",
        `Keywords are near-duplicates: ${nearDuplicate}`
      )
    );
  }

  validateText(
    format,
    "keywords",
    keywords.join(" "),
    rules,
    errors,
    warnings
  );
}

function validateAdobe(
  meta: StockMetadata,
  rules: ReturnType<typeof rulesFor>,
  limits: ReturnType<typeof resolveLimits>,
  errors: ValidationIssue[],
  warnings: ValidationIssue[]
): void {
  const title = meta.title.trim();
  if (!title) {
    errors.push(issue("adobe", "title", "error", "Title is required"));
  } else {
    if (title.length > rules.titleMax) {
      errors.push(
        issue(
          "adobe",
          "title",
          "error",
          `Title must be ${rules.titleMax} characters or fewer (currently ${title.length})`
        )
      );
    }
    if (title.includes(",")) {
      errors.push(
        issue("adobe", "title", "error", "Title cannot be a comma-separated keyword list")
      );
    }
    if (rules.titleListPattern.test(title)) {
      errors.push(
        issue(
          "adobe",
          "title",
          "error",
          "Title reads like a list of keywords rather than a natural phrase"
        )
      );
    }
    validateText("adobe", "title", title, rules, errors, warnings);
  }

  if (!isValidAdobeCategory(meta.category)) {
    errors.push(
      issue("adobe", "category", "error", "Category must be a valid Adobe ID (1-21)")
    );
  }

  validateKeywords(
    "adobe",
    meta.keywords,
    rules,
    limits,
    errors,
    warnings
  );
}

function validateShutterstock(
  meta: StockMetadata,
  rules: ReturnType<typeof rulesFor>,
  limits: ReturnType<typeof resolveLimits>,
  errors: ValidationIssue[],
  warnings: ValidationIssue[]
): void {
  const title = meta.title.trim();
  if (!title) {
    errors.push(issue("shutterstock", "title", "error", "Title is required"));
  } else {
    if (title.length > rules.titleMax) {
      errors.push(
        issue(
          "shutterstock",
          "title",
          "error",
          `Title must be ${rules.titleMax} characters or fewer`
        )
      );
    }
    if (rules.titleListPattern.test(title)) {
      errors.push(
        issue(
          "shutterstock",
          "title",
          "error",
          "Title reads like a list of keywords rather than a natural phrase"
        )
      );
    }
    validateText("shutterstock", "title", title, rules, errors, warnings);
  }

  const description = meta.description.trim();
  if (!description) {
    errors.push(
      issue("shutterstock", "description", "error", "Description is required")
    );
  } else if (description.length > rules.descriptionMax) {
    errors.push(
      issue(
        "shutterstock",
        "description",
        "error",
        `Description must be ${rules.descriptionMax} characters or fewer`
      )
    );
  } else {
    validateText("shutterstock", "description", description, rules, errors, warnings);
  }

  if (!isValidShutterstockCategories(meta.category)) {
    errors.push(
      issue(
        "shutterstock",
        "category",
        "error",
        "Categories must be 1-2 valid Shutterstock category names"
      )
    );
  }

  validateKeywords(
    "shutterstock",
    meta.keywords,
    rules,
    limits,
    errors,
    warnings
  );
}

export function validateGeneratedMetadata(
  metadata: GeneratedMetadata,
  settings: GenerationSettings
): ValidationReport {
  const limits = resolveLimits(settings);
  const adobeRules = rulesFor("adobe");
  const shutterstockRules = rulesFor("shutterstock");
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  validateAdobe(
    metadata.adobe,
    adobeRules,
    limits,
    errors,
    warnings
  );
  validateShutterstock(
    metadata.shutterstock,
    shutterstockRules,
    limits,
    errors,
    warnings
  );

  return { errors, warnings };
}

export function computeQualityScore(
  metadata: GeneratedMetadata,
  report: ValidationReport
): number {
  let score = 100;

  for (const issue of report.errors) {
    if (issue.component === "title") score -= 8;
    else if (issue.component === "keywords") score -= 4;
    else if (issue.component === "category") score -= 6;
    else if (issue.component === "description") score -= 5;
    else score -= 3;
  }
  for (const issue of report.warnings) {
    if (issue.component === "title") score -= 2;
    else if (issue.component === "keywords") score -= 1;
    else score -= 1;
  }

  const adobeKw = metadata.adobe.keywords;
  const adobeSingle = adobeKw.filter((k) => k.split(/\s+/).length === 1).length;
  if (adobeKw.length > 0) {
    const singleRatio = adobeSingle / adobeKw.length;
    if (singleRatio < 0.4) score -= 3;
    else if (singleRatio > 0.7) score += 2;
  }

  const adobeTitle = metadata.adobe.title.trim();
  if (adobeTitle.length > 0) {
    const words = adobeTitle.split(/\s+/);
    const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
    if (words.length > 3 && uniqueWords.size < words.length * 0.6) score -= 4;
    if (adobeTitle.length <= 60) score += 1;
  }

  const shutterKw = metadata.shutterstock.keywords;
  if (shutterKw.length >= 7 && shutterKw.length <= 50) score += 1;

  return Math.max(0, Math.min(100, score));
}
