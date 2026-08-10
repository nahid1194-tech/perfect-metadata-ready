const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_HASH_PATTERN = /\b[0-9a-f]{16,}\b/gi;
const LONG_TIMESTAMP_PATTERN = /\b\d{13,}\b/g;
const IDENTIFIER_WORD_PATTERN =
  /\b(?:uuid|random[\s_-]?id|asset[\s_-]?id|file[\s_-]?name)\b/gi;
const IMG_NUMBER_PATTERN = /\b(?:img|image|photo|pic|png|jpg|jpeg)[-_]?\d{4,}\b/gi;
const LONG_ALNUM_PATTERN = /\b(?=[a-z0-9]*\d)[a-z0-9]{12,}\b/gi;

const PATTERNS = [
  UUID_PATTERN,
  LONG_HASH_PATTERN,
  LONG_TIMESTAMP_PATTERN,
  IDENTIFIER_WORD_PATTERN,
  IMG_NUMBER_PATTERN,
  LONG_ALNUM_PATTERN,
];

export function stripFilenameTokens(value: string): string {
  let result = value;
  for (const pattern of PATTERNS) {
    result = result.replace(pattern, " ");
  }
  return result.replace(/\s+/g, " ").trim();
}

export function findFilenameTokens(value: string): string[] {
  const matches = new Set<string>();
  for (const pattern of PATTERNS) {
    for (const match of value.matchAll(pattern)) {
      matches.add(match[0]);
    }
  }
  return Array.from(matches);
}

export function containsFilenameTokens(value: string): boolean {
  return findFilenameTokens(value).length > 0;
}
