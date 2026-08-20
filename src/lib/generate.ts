import type {
  ApiProvider,
  CsvFormat,
  GeneratedMetadata,
  GenerationResult,
  GenerationSettings,
  ImageAnalysis,
  ImageAsset,
  StockMetadata,
} from "@/lib/types";
import { devLog } from "@/lib/dev-log";
import {
  ADOBE_CATEGORIES,
  ADOBE_KEYWORDS_MAX,
  ADOBE_TITLE_MAX,
  SHUTTERSTOCK_KEYWORDS_MAX,
  SHUTTERSTOCK_KEYWORDS_MIN,
  SHUTTERSTOCK_TITLE_MAX,
  isValidAdobeCategory,
  normalizeShutterstockCategories,
} from "@/lib/stock-spec";
import {
  ANALYSIS_MAX_DIMENSION,
  ANALYSIS_QUALITY_MAX_DIMENSION,
  prepareImageForApi,
} from "@/lib/image-process";
import {
  backgroundRules,
  detectBackground,
  type BackgroundDetection,
} from "@/lib/background";
import { imageContentHash } from "@/lib/cache";
import { createProfiler, logProfile } from "@/lib/perf";
import { stripFilenameTokens } from "@/lib/filename";
import {
  buildAnalysisPrompt,
  buildMetadataPrompt,
  buildRefinePrompt,
  EMPTY_ANALYSIS,
  extractJson,
  parseAnalysis,
} from "@/lib/prompts";
import {
  computeQualityScore,
  validateGeneratedMetadata,
  type ValidationReport,
} from "@/lib/metadata-validator";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENAI_API_BASE = "https://api.openai.com/v1";
const MISTRAL_API_BASE = "https://api.mistral.ai/v1";

const DEFAULT_RATE_LIMIT_MS = 30_000;

export class GeminiApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  retryAfterMs?: number;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown
  ) {
    super(message);
    this.name = "GeminiApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NoActiveKeyError extends Error {
  constructor() {
    super("No active API key available.");
    this.name = "NoActiveKeyError";
  }
}

export class MetadataQualityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetadataQualityError";
  }
}

export class RateLimitedError extends Error {
  delayMs: number;

  constructor(delayMs: number) {
    super("All active API keys are temporarily rate-limited.");
    this.name = "RateLimitedError";
    this.delayMs = delayMs;
  }
}

type GeminiErrorBody = {
  error?: {
    message?: string;
    code?: number;
    status?: string;
    details?: Array<{ retryDelay?: string }>;
  };
};

function parseDuration(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d+)(ms|s|m|h)?$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  if (unit === "ms") return amount;
  if (unit === "m") return amount * 60_000;
  if (unit === "h") return amount * 3_600_000;
  return amount * 1000;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function parseRetryDelay(
  header: string | null,
  payload: GeminiErrorBody | null
): number | undefined {
  const candidates: number[] = [];
  const fromHeader = parseRetryAfter(header);
  if (fromHeader) candidates.push(fromHeader);
  for (const detail of payload?.error?.details ?? []) {
    const parsed = parseDuration(detail?.retryDelay);
    if (parsed) candidates.push(parsed);
  }
  return candidates.length > 0 ? Math.max(...candidates) : undefined;
}

type GeminiCandidatesBody = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

function buildApiError(
  data: unknown,
  rawBody: string,
  status: number,
  fallback: string,
  retryAfter: string | null = null
): GeminiApiError {
  const payload = data as GeminiErrorBody | null;
  const error = new GeminiApiError(
    payload?.error?.message ?? fallback,
    status,
    payload?.error?.status ??
      (payload?.error?.code != null ? String(payload.error.code) : undefined),
    data ?? rawBody
  );
  error.retryAfterMs = parseRetryDelay(retryAfter, payload);
  return error;
}

type OpenAIApiErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: string | number | null;
  };
};

function buildOpenAIError(
  data: unknown,
  rawBody: string,
  status: number,
  fallback: string
): GeminiApiError {
  const payload = data as OpenAIApiErrorBody | null;
  const error = new GeminiApiError(
    payload?.error?.message ?? fallback,
    status,
    payload?.error?.code != null
      ? String(payload.error.code)
      : payload?.error?.type,
    data ?? rawBody
  );
  return error;
}

type MistralApiErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: string | number | null;
  };
  message?: string;
  type?: string;
  code?: string | number | null;
};

function buildMistralError(
  data: unknown,
  rawBody: string,
  status: number,
  fallback: string
): GeminiApiError {
  const payload = data as MistralApiErrorBody | null;
  const nested = payload?.error;
  const error = new GeminiApiError(
    nested?.message ?? payload?.message ?? fallback,
    status,
    nested?.code != null
      ? String(nested.code)
      : nested?.type ?? (payload?.code != null ? String(payload.code) : payload?.type),
    data ?? rawBody
  );
  return error;
}

export function isKeyFailure(error: unknown): boolean {
  if (!(error instanceof GeminiApiError)) return false;
  const message = error.message;
  return (
    error.status === 401 ||
    error.status === 403 ||
    error.status === 429 ||
    /api key|quota|exhausted|rate\s*limit|permission/i.test(message)
  );
}

export function isQuotaExceeded(error: unknown): boolean {
  if (!(error instanceof GeminiApiError)) return false;
  return (
    error.status === 429 &&
    /quota|exhausted|daily\s*limit|billing/i.test(error.message)
  );
}

export function isModelBusy(error: unknown): boolean {
  if (!(error instanceof GeminiApiError)) return false;
  return (
    error.status === 503 ||
    error.status === 502 ||
    error.status === 500 ||
    /model\s*busy|overloaded|service\s*unavailable|temporarily\s*unavailable|server\s*error|temporary\s*server/i.test(
      error.message
    )
  );
}

export function isModelUnavailable(error: unknown): boolean {
  if (!(error instanceof GeminiApiError)) return false;
  if (isModelBusy(error)) return true;
  if (error.status === 404) return true;
  if (error.status === 400 && /model/i.test(error.message)) {
    return !/image|inline_data|unsupported|corrupt|decoding/i.test(error.message);
  }
  return /model\s*(not\s*found|does\s*not\s*exist|not\s*supported|unavailable|no\s*longer)/i.test(
    error.message
  );
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof GeminiApiError) return error.status === 0;
  return (
    error instanceof TypeError && /fetch|network|failed to fetch/i.test(error.message)
  );
}

export function isInvalidImageError(error: unknown): boolean {
  if (!(error instanceof GeminiApiError)) return false;
  return (
    error.status === 400 &&
    /image|inline_data|unsupported|corrupt|decoding/i.test(error.message)
  );
}

export function isRateLimited(error: unknown): boolean {
  if (!(error instanceof GeminiApiError)) return false;
  return (
    error.status === 429 ||
    error.code === "RESOURCE_EXHAUSTED" ||
    /quota|exhausted|rate\s*limit|too\s*many\s*requests/i.test(error.message)
  );
}

export function rateLimitDelayMs(error: unknown): number {
  if (error instanceof GeminiApiError && error.retryAfterMs) {
    return error.retryAfterMs;
  }
  return DEFAULT_RATE_LIMIT_MS;
}

export function isProviderSwitchTrigger(error: unknown): boolean {
  return isRateLimited(error) || isModelBusy(error) || isKeyFailure(error);
}

export function providerSwitchReason(error: unknown): string {
  if (!(error instanceof GeminiApiError)) {
    return error instanceof Error ? error.message : "Unknown error";
  }
  if (isRateLimited(error)) {
    if (error.status === 429) return "HTTP 429 Rate Limited";
    if (error.code === "RESOURCE_EXHAUSTED")
      return "Quota exceeded (RESOURCE_EXHAUSTED)";
    return "Rate limit or quota exceeded";
  }
  if (isModelBusy(error)) {
    if (error.status === 503) return "503 Service Unavailable";
    if (error.status === 502) return "502 Bad Gateway";
    if (error.status === 500) return "500 Server Error";
    return "Model busy / temporary server error";
  }
  if (isKeyFailure(error)) {
    if (error.status === 401) return "Invalid API Key (401)";
    if (error.status === 403) return "API key permission denied (403)";
    return "Invalid or exhausted API key";
  }
  return error.message || `HTTP ${error.status}`;
}

export function friendlyApiError(error: unknown): string {
  if (error instanceof GeminiApiError) {
    const raw = error.message;
    if (error.status === 401) {
      return `Invalid API Key — ${raw}`;
    }
    if (error.status === 403) {
      return `API Key Permission Denied — ${raw}`;
    }
    if (isQuotaExceeded(error)) {
      return `Daily quota reached. Switching to the next API key... — ${raw}`;
    }
    if (error.status === 429) {
      return `Rate Limit Reached. Switching to the next API key... — ${raw}`;
    }
    if (error.status === 503 || isModelBusy(error)) {
      return `Model Busy. Retrying with another model... — ${raw}`;
    }
    if (isInvalidImageError(error)) {
      return `Unsupported or corrupted image — ${raw}`;
    }
    return raw;
  }
  if (isNetworkError(error)) {
    const raw = error instanceof Error ? error.message : "";
    return raw
      ? `Please check your internet connection — ${raw}`
      : "Please check your internet connection";
  }
  return error instanceof Error ? error.message : "Generation failed";
}

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  platform: "adobe",
  titleLength: 60,
  descriptionLength: 300,
  keywordCount: 20,
  prefix: "",
  suffix: "",
  negativeTitleWords: "",
  negativeKeywords: "",
  enablePrefix: false,
  enableSuffix: false,
  enableNegativeTitleWords: false,
  enableNegativeKeywords: false,
  maxConcurrent: 3,
};

function splitKeywordPhrase(phrase: string): string[] {
  const words = phrase.replace(/,/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length === 1) return [words[0]];
  if (words.length === 2) return [words.join(" ").trim()];
  const head = words[words.length - 1];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };
  push(head);
  for (let i = 0; i < words.length - 1; i++) {
    push(`${words[i]} ${head}`);
  }
  for (let i = 0; i < words.length - 1; i++) {
    push(words[i]);
  }
  return out;
}

function splitTerms(value: string): string[] {
  return value
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncateWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const words = text.split(/\s+/);
  let out = "";
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

const TITLE_CONNECTOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "over",
  "the",
  "to",
  "via",
  "with",
]);

function fitTitle(title: string, maxChars: number): string {
  let fitted = title.replace(/\s+/g, " ").trim();
  if (fitted.length <= maxChars) {
    return fitted.replace(/[,\-;:]\s*$/, "").trim();
  }
  const words = fitted.split(" ");
  while (words.length > 1 && fitted.length > maxChars) {
    words.pop();
    fitted = words.join(" ");
  }
  while (
    words.length > 1 &&
    TITLE_CONNECTOR_WORDS.has(words[words.length - 1].replace(/[^a-zA-Z]/g, "").toLowerCase())
  ) {
    words.pop();
    fitted = words.join(" ");
  }
  return fitted.replace(/[,\-;:]\s*$/, "").trim();
}

function categoryLabelWords(category: string): string[] {
  const raw = category.trim();
  if (!raw) return [];
  if (/^\d+$/.test(raw)) {
    const label = ADOBE_CATEGORIES.find((entry) => String(entry.id) === raw)?.label;
    return label ? label.split(/\s+/) : [];
  }
  return raw.split(/[,\s]+/);
}

function buildKeywordPool(meta: StockMetadata): string[] {
  return [
    ...meta.keywords,
    ...meta.title.split(/\s+/),
    ...(meta.description ? meta.description.split(/\s+/) : []),
    ...categoryLabelWords(meta.category),
  ];
}

function enforceKeywords(values: string[], pool: string[], target: number): string[] {
  const seen = new Set<string>();
  const seenWords = new Set<string>();
  const out: string[] = [];
  const push = (item: string) => {
    const clean = stripFilenameTokens(
      item.replace(/,/g, "").replace(/\s+/g, " ").trim()
    );
    const key = clean.toLowerCase();
    if (!clean || key.length < 3 || seen.has(key)) return;
    const words = key.split(/\s+/);
    if (words.length > 1) {
      const uniqueWords = words.filter((w) => !seenWords.has(w));
      if (uniqueWords.length === 0) return;
    }
    seen.add(key);
    for (const word of words) seenWords.add(word);
    out.push(clean);
  };
  for (const value of values) {
    const candidates = splitKeywordPhrase(value);
    const singleWord = candidates.find((c) => c.split(/\s+/).length === 1);
    const multiWord = candidates.find((c) => c.split(/\s+/).length > 1);
    if (singleWord) {
      push(singleWord);
      if (out.length >= target) break;
    }
    if (multiWord) {
      push(multiWord);
      if (out.length >= target) break;
    }
    if (out.length >= target) break;
  }
  for (const value of pool) {
    const candidates = splitKeywordPhrase(value);
    const singleWord = candidates.find((c) => c.split(/\s+/).length === 1);
    const multiWord = candidates.find((c) => c.split(/\s+/).length > 1);
    if (singleWord) {
      push(singleWord);
      if (out.length >= target) break;
    }
    if (multiWord) {
      push(multiWord);
      if (out.length >= target) break;
    }
    if (out.length >= target) break;
  }
  return out.slice(0, target);
}

function enforceTwoWordLimit(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const keyword of keywords) {
    const replacement =
      keyword.split(/\s+/).filter(Boolean).length > 2
        ? splitKeywordPhrase(keyword)[0]
        : keyword;
    const clean = replacement.replace(/,/g, "").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function applySettings(
  metadata: GeneratedMetadata,
  settings: GenerationSettings
): GeneratedMetadata {
  const negativeTitle = settings.enableNegativeTitleWords
    ? splitTerms(settings.negativeTitleWords)
    : [];
  const negativeKeywords = settings.enableNegativeKeywords
    ? splitTerms(settings.negativeKeywords)
    : [];
  const prefix = settings.enablePrefix ? settings.prefix.trim() : "";
  const suffix = settings.enableSuffix ? settings.suffix.trim() : "";

  const cleanTitle = (title: string): string => {
    let result = title;
    for (const term of negativeTitle) {
      result = result.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi"), " ");
    }
    return result.replace(/\s+/g, " ").trim();
  };

  const fitTitleWithAffixes = (body: string, maxChars: number): string => {
    const bodyMax =
      maxChars -
      prefix.length -
      suffix.length -
      (prefix ? 1 : 0) -
      (suffix ? 1 : 0);
    const fitted = bodyMax > 0 ? fitTitle(body, bodyMax) : "";
    const composed = [prefix, fitted, suffix].filter(Boolean).join(" ");
    return composed.length <= maxChars ? composed : composed.slice(0, maxChars);
  };

  const adobeTitleMax = Math.min(settings.titleLength, ADOBE_TITLE_MAX);
  const shutterstockTitleMax = Math.min(
    settings.titleLength,
    SHUTTERSTOCK_TITLE_MAX
  );
  const adobeKeywordCount = Math.max(
    1,
    Math.min(settings.keywordCount, ADOBE_KEYWORDS_MAX)
  );
  const shutterstockKeywordCount = Math.max(
    SHUTTERSTOCK_KEYWORDS_MIN,
    Math.min(settings.keywordCount, SHUTTERSTOCK_KEYWORDS_MAX)
  );

  const adobeKeywords = metadata.adobe.keywords.filter(
    (keyword) => !negativeKeywords.includes(keyword.toLowerCase())
  );
  const shutterstockKeywords = metadata.shutterstock.keywords.filter(
    (keyword) => !negativeKeywords.includes(keyword.toLowerCase())
  );

  return {
    adobe: {
      ...metadata.adobe,
      title: fitTitleWithAffixes(cleanTitle(metadata.adobe.title), adobeTitleMax),
      description: truncateWords(metadata.adobe.description, settings.descriptionLength),
      keywords: enforceTwoWordLimit(
        enforceKeywords(
          adobeKeywords,
          buildKeywordPool(metadata.adobe),
          adobeKeywordCount
        )
      ),
    },
    shutterstock: {
      ...metadata.shutterstock,
      title: fitTitleWithAffixes(
        cleanTitle(metadata.shutterstock.title),
        shutterstockTitleMax
      ),
      description: truncateWords(
        metadata.shutterstock.description,
        Math.min(settings.descriptionLength, SHUTTERSTOCK_TITLE_MAX)
      ),
      keywords: enforceTwoWordLimit(
        enforceKeywords(
          shutterstockKeywords,
          buildKeywordPool(metadata.shutterstock),
          shutterstockKeywordCount
        )
      ),
    },
  };
}

export function buildNeutralMetadata(): GeneratedMetadata {
  return {
    adobe: { title: "", description: "", keywords: [], category: "" },
    shutterstock: { title: "", description: "", keywords: [], category: "" },
  };
}

function sanitizeKeywords(
  value: unknown,
  max: number,
  fallback: string[]
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const seenWords = new Set<string>();
  const push = (keyword: string) => {
    const clean = stripFilenameTokens(keyword.replace(/,/g, "").trim());
    const key = clean.toLowerCase();
    if (!clean || key.length < 3 || seen.has(key)) return;
    const words = key.split(/\s+/);
    if (words.length > 1) {
      const uniqueWords = words.filter((w) => !seenWords.has(w));
      if (uniqueWords.length === 0) return;
    }
    seen.add(key);
    for (const word of words) seenWords.add(word);
    out.push(clean);
  };
  const source = Array.isArray(value) ? value.map(String) : [];
  for (const keyword of source) {
    const candidates = splitKeywordPhrase(keyword);
    const singleWord = candidates.find((c) => c.split(/\s+/).length === 1);
    const multiWord = candidates.find((c) => c.split(/\s+/).length > 1);
    if (singleWord) {
      push(singleWord);
      if (out.length >= max) break;
    }
    if (multiWord) {
      push(multiWord);
      if (out.length >= max) break;
    }
    if (out.length >= max) break;
  }
  if (out.length < SHUTTERSTOCK_KEYWORDS_MIN) {
    for (const keyword of fallback) {
      for (const candidate of splitKeywordPhrase(keyword)) {
        push(candidate);
        if (out.length >= SHUTTERSTOCK_KEYWORDS_MIN) break;
      }
      if (out.length >= SHUTTERSTOCK_KEYWORDS_MIN) break;
    }
  }
  return out;
}

function normalize(
  raw: unknown,
  fallback: StockMetadata,
  format: CsvFormat
): StockMetadata {
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as {
    title?: unknown;
    description?: unknown;
    keywords?: unknown;
    category?: unknown;
  };

  const maxKeywords =
    format === "adobe" ? ADOBE_KEYWORDS_MAX : SHUTTERSTOCK_KEYWORDS_MAX;

  const rawCategory = String(value.category ?? "").trim();
  const category =
    format === "adobe"
      ? isValidAdobeCategory(rawCategory)
        ? rawCategory
        : fallback.category
      : rawCategory.trim()
        ? normalizeShutterstockCategories(rawCategory).join(", ")
        : fallback.category;

  const title = stripFilenameTokens(String(value.title ?? "").trim());
  const description = stripFilenameTokens(String(value.description ?? "").trim());
  const adobeTitle =
    format === "adobe"
      ? title.replace(/,/g, " ").replace(/\s+/g, " ").trim()
      : title;

  const normalized = {
    title: adobeTitle || fallback.title,
    description: description || fallback.description,
    keywords: sanitizeKeywords(value.keywords, maxKeywords, fallback.keywords),
    category,
  };
  return format === "adobe"
    ? { ...normalized, description: "" }
    : normalized;
}

export async function testGeminiConnection(apiKey: string): Promise<number> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE}/models?key=${encodeURIComponent(apiKey)}`,
      { method: "GET" }
    );
  } catch (error) {
    console.error("[Gemini] Network error while testing the connection", error);
    throw new GeminiApiError(
      error instanceof Error ? error.message : "Network request failed",
      0
    );
  }

  const rawBody = await response.text();
  let data: unknown = null;
  try {
    data = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    data = null;
  }

  console.log("[Gemini] Connection test response", {
    status: response.status,
    statusText: response.statusText,
    body: data ?? rawBody,
  });

  if (!response.ok) {
    throw buildApiError(
      data,
      rawBody,
      response.status,
      `Connection failed (${response.status})`,
      response.headers.get("retry-after")
    );
  }

  const json = data as { models?: unknown } | null;
  return Array.isArray(json?.models) ? json.models.length : 0;
}

export async function testOpenAIConnection(apiKey: string): Promise<number> {
  let response: Response;
  try {
    response = await fetch(`${OPENAI_API_BASE}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    console.error("[OpenAI] Network error while testing the connection", error);
    throw new GeminiApiError(
      error instanceof Error ? error.message : "Network request failed",
      0
    );
  }

  const rawBody = await response.text();
  let data: unknown = null;
  try {
    data = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    data = null;
  }

  console.log("[OpenAI] Connection test response", {
    status: response.status,
    statusText: response.statusText,
    body: data ?? rawBody,
  });

  if (!response.ok) {
    throw buildOpenAIError(
      data,
      rawBody,
      response.status,
      `Connection failed (${response.status})`
    );
  }

  const json = data as { data?: unknown[] } | null;
  return Array.isArray(json?.data) ? json.data.length : 0;
}

export async function testMistralConnection(apiKey: string): Promise<number> {
  let response: Response;
  try {
    response = await fetch(`${MISTRAL_API_BASE}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    console.error("[Mistral] Network error while testing the connection", error);
    throw new GeminiApiError(
      error instanceof Error ? error.message : "Network request failed",
      0
    );
  }

  const rawBody = await response.text();
  let data: unknown = null;
  try {
    data = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    data = null;
  }

  console.log("[Mistral] Connection test response", {
    status: response.status,
    statusText: response.statusText,
    body: data ?? rawBody,
  });

  if (!response.ok) {
    throw buildMistralError(
      data,
      rawBody,
      response.status,
      `Connection failed (${response.status})`
    );
  }

  const json = data as { data?: unknown[] } | null;
  return Array.isArray(json?.data) ? json.data.length : 0;
}

function parseMetadata(text: string): {
  adobe?: unknown;
  shutterstock?: unknown;
} | null {
  try {
    const json = JSON.parse(extractJson(text)) as {
      adobe?: unknown;
      shutterstock?: unknown;
    } | null;
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  }
}

const ANALYSIS_MAX_RETRIES = 2;
const REFINE_MAX_ROUNDS = 2;

function mergeRefinedMetadata(
  current: GeneratedMetadata,
  refined: {
    adobe?: unknown;
    shutterstock?: unknown;
  } | null
): GeneratedMetadata {
  if (!refined) return current;
  return {
    adobe: normalize(refined.adobe, current.adobe, "adobe"),
    shutterstock: normalize(
      refined.shutterstock,
      current.shutterstock,
      "shutterstock"
    ),
  };
}

type PreparedAnalysis = {
  dataUrl: string;
  mimeType: string;
  background: BackgroundDetection;
};

const preparedAnalysisCache = new Map<string, Promise<PreparedAnalysis>>();

async function getPreparedAnalysis(
  image: ImageAsset,
  dimension = ANALYSIS_MAX_DIMENSION
): Promise<PreparedAnalysis> {
  const cacheKey = `${image.id}@${dimension}`;
  const cached = preparedAnalysisCache.get(cacheKey);
  if (cached) return cached;
  const promise = (async () => {
    const profiler = createProfiler();
    profiler.start("prepare");
    const prepared = await prepareImageForApi(image, { maxDimension: dimension });
    profiler.end("prepare");
    profiler.start("background");
    const background = await detectBackground(prepared.dataUrl);
    profiler.end("background");
    logProfile(`${image.name}:prepare@${dimension}`, profiler.result());
    return { ...prepared, background };
  })();
  preparedAnalysisCache.set(cacheKey, promise);
  return promise;
}

export async function prepareImage(image: ImageAsset): Promise<void> {
  await getPreparedAnalysis(image);
  await imageContentHash(image);
}

export function warmUpProvider(provider: ApiProvider): void {
  try {
    const base =
      provider === "gemini"
        ? API_BASE
        : provider === "openai"
          ? OPENAI_API_BASE
          : MISTRAL_API_BASE;
    void fetch(base, { method: "GET", cache: "no-store" }).catch(() => {
      // Warm-up pings are best-effort; ignore failures.
    });
  } catch {
    // Ignore warm-up failures.
  }
}

async function runGenerationPipeline(args: {
  image: ImageAsset;
  fallback: GeneratedMetadata;
  settings: GenerationSettings;
  platform: "adobe" | "shutterstock";
  call: (
    prompt: string,
    includeImage?: boolean,
    dimension?: number
  ) => Promise<string>;
}): Promise<{
  metadata: GeneratedMetadata;
  report: ValidationReport;
  timing: Record<string, number>;
}> {
  const { image, fallback, settings, platform, call } = args;
  const profiler = createProfiler();

  const runPass = async (
    dimension: number
  ): Promise<{ metadata: GeneratedMetadata; report: ValidationReport }> => {
    const { background } = await getPreparedAnalysis(image, dimension);
    const bgRules = backgroundRules(background);

    // Stage 1: deep multi-pass visual analysis (image attached once).
    profiler.start("analysis");
    let analysis: ImageAnalysis = EMPTY_ANALYSIS;
    for (let attempt = 0; attempt < ANALYSIS_MAX_RETRIES; attempt++) {
      const analysisPrompt = buildAnalysisPrompt({ bgRules });
      const analysisRaw = await call(analysisPrompt, true, dimension);
      const parsed = parseAnalysis(analysisRaw);
      if (parsed) {
        analysis = parsed;
        break;
      }
    }
    profiler.end("analysis");
    if (analysis === EMPTY_ANALYSIS) {
      devLog({
        event: "analysis-failed",
        imageId: image.id,
        name: image.name,
        attempts: ANALYSIS_MAX_RETRIES,
      });
      throw new MetadataQualityError(
        `Visual analysis failed for "${image.name}" after ${ANALYSIS_MAX_RETRIES} attempts`
      );
    }
    devLog({
      event: "analysis-complete",
      imageId: image.id,
      name: image.name,
      platform,
    });

    // Stage 2: generate metadata from the analysis (text-only, image reused
    // from the prepared analysis — no second image upload).
    profiler.start("metadata");
    const metadataPrompt = buildMetadataPrompt({
      settings,
      bgRules,
      analysis,
      platform,
    });
    const raw = await call(metadataPrompt, false, dimension);
    const parsed = parseMetadata(raw);
    if (!parsed) {
      devLog({
        event: "metadata-parse-failed",
        imageId: image.id,
        name: image.name,
      });
      throw new MetadataQualityError(
        `Metadata response could not be parsed for "${image.name}"`
      );
    }
    devLog({
      event: "metadata-generated",
      imageId: image.id,
      name: image.name,
      platform,
    });

    let metadata: GeneratedMetadata = {
      adobe: normalize(parsed.adobe, fallback.adobe, "adobe"),
      shutterstock: normalize(
        parsed.shutterstock,
        fallback.shutterstock,
        "shutterstock"
      ),
    };
    profiler.end("metadata");

    // Stage 3: application-side validation. Validation failures are hard
    // errors: we never fall back to generic/fabricated metadata.
    let report = validateGeneratedMetadata(metadata, settings);
    devLog({
      event: "validation",
      imageId: image.id,
      name: image.name,
      errors: report.errors.map(
        (issue) => `[${issue.format}][${issue.component}] ${issue.message}`
      ),
      warnings: report.warnings.map(
        (issue) => `[${issue.format}][${issue.component}] ${issue.message}`
      ),
    });

    // Stage 4: targeted refinement of failing components only (text-only).
    for (
      let round = 0;
      round < REFINE_MAX_ROUNDS && report.errors.length > 0;
      round++
    ) {
      const refinePrompt = buildRefinePrompt({
        settings,
        bgRules,
        analysis,
        metadata,
        issues: report.errors,
        platform,
      });
      const refinedRaw = await call(refinePrompt, false, dimension);
      const refined = parseMetadata(refinedRaw);
      if (!refined) break;
      metadata = mergeRefinedMetadata(metadata, refined);
      report = validateGeneratedMetadata(metadata, settings);
    }

    return { metadata, report };
  };

  const validationError = (report: ValidationReport): string =>
    `Metadata still fails validation for "${image.name}" after refinement: ${report.errors
      .map((issue) => `[${issue.format}][${issue.component}] ${issue.message}`)
      .join("; ")}`;

  // Pass 1: standard analysis resolution.
  const primary = await runPass(ANALYSIS_MAX_DIMENSION);
  if (primary.report.errors.length === 0) {
    logProfile(`${image.name}:generate`, profiler.result());
    return { metadata: primary.metadata, report: primary.report, timing: profiler.result() };
  }

  // Pass 2 (quality fallback): re-run the full pass once at a higher
  // resolution, so images that fail validation at the standard size get a
  // second chance at full detail before being reported as failed.
  if (ANALYSIS_QUALITY_MAX_DIMENSION > ANALYSIS_MAX_DIMENSION) {
    profiler.start("qualityFallback");
    const quality = await runPass(ANALYSIS_QUALITY_MAX_DIMENSION);
    profiler.end("qualityFallback");
    if (quality.report.errors.length === 0) {
      devLog({
        event: "quality-fallback-success",
        imageId: image.id,
        name: image.name,
      });
      logProfile(`${image.name}:generate`, profiler.result());
      return { metadata: quality.metadata, report: quality.report, timing: profiler.result() };
    }
    devLog({
      event: "validation-remaining",
      imageId: image.id,
      name: image.name,
      errors: quality.report.errors.map(
        (issue) => `[${issue.format}][${issue.component}] ${issue.message}`
      ),
    });
    throw new MetadataQualityError(validationError(quality.report));
  }

  devLog({
    event: "validation-remaining",
    imageId: image.id,
    name: image.name,
    errors: primary.report.errors.map(
      (issue) => `[${issue.format}][${issue.component}] ${issue.message}`
    ),
  });
  throw new MetadataQualityError(validationError(primary.report));
}

async function callGemini(
  parts: unknown[],
  apiKey: string,
  model: string,
  temperature: number,
  signal?: AbortSignal
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature,
            responseMimeType: "application/json",
            maxOutputTokens: 2048,
          },
        }),
      }
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error("[Gemini] Network error while calling the API", error);
    throw new GeminiApiError(
      error instanceof Error ? error.message : "Network request failed",
      0
    );
  }

  const rawBody = await response.text();
  let data: unknown = null;
  try {
    data = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    data = null;
  }

  console.log(`[Gemini] ${response.status} ${response.statusText}`);

  if (!response.ok) {
    throw buildApiError(
      data,
      rawBody,
      response.status,
      `API request failed (${response.status})`,
      response.headers.get("retry-after")
    );
  }

  const json = data as GeminiCandidatesBody | null;
  return (
    json?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? ""
  );
}

async function analysisImageParts(
  image: ImageAsset,
  dimension = ANALYSIS_MAX_DIMENSION
): Promise<unknown[]> {
  const { dataUrl, mimeType } = await getPreparedAnalysis(image, dimension);
  const base64 = dataUrl.split(",")[1] ?? dataUrl;
  if (!base64 || base64.length === 0) {
    throw new GeminiApiError(
      "Image data is empty after preparation. The source image may be corrupted or unsupported.",
      400
    );
  }
  return [{ inline_data: { mime_type: mimeType, data: base64 } }];
}

export async function generateWithApi(
  image: ImageAsset,
  apiKey: string,
  model = "gemini-3.6-flash",
  settings: Partial<GenerationSettings> = {},
  signal?: AbortSignal
): Promise<GenerationResult> {
  const fullSettings: GenerationSettings = {
    ...DEFAULT_GENERATION_SETTINGS,
    ...settings,
  };
  const fallback = buildNeutralMetadata();

  const pipeline = await runGenerationPipeline({
    image,
    fallback,
    settings: fullSettings,
    platform: fullSettings.platform,
    call: async (prompt, includeImage = true, dimension) => {
      const parts = includeImage
        ? await analysisImageParts(image, dimension)
        : [];
      parts.push({ text: prompt });
      return callGemini(parts, apiKey, model, 0.3, signal);
    },
  });

  return {
    id: crypto.randomUUID(),
    imageId: image.id,
    createdAt: new Date().toISOString(),
    imageName: image.name,
    metadata: applySettings(pipeline.metadata, fullSettings),
    qualityScore: computeQualityScore(pipeline.metadata, pipeline.report),
    timingMs: pipeline.timing,
  };
}

async function callOpenAI(
  text: string,
  imageUrl: string | undefined,
  apiKey: string,
  model: string,
  temperature: number,
  signal?: AbortSignal
): Promise<string> {
  let response: Response;
  try {
    const content: unknown[] = imageUrl
      ? [
          { type: "text", text },
          { type: "image_url", image_url: { url: imageUrl } },
        ]
      : [{ type: "text", text }];
    response = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
      body: JSON.stringify({
        model,
        temperature,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error("[OpenAI] Network error while calling the API", error);
    throw new GeminiApiError(
      error instanceof Error ? error.message : "Network request failed",
      0
    );
  }

  const rawBody = await response.text();
  let data: unknown = null;
  try {
    data = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    data = null;
  }

  console.log(`[OpenAI] ${response.status} ${response.statusText}`);

  if (!response.ok) {
    throw buildOpenAIError(
      data,
      rawBody,
      response.status,
      `API request failed (${response.status})`
    );
  }

  const json = data as
    | { choices?: Array<{ message?: { content?: string } }> }
    | null;
  return json?.choices?.[0]?.message?.content ?? "";
}

export async function generateWithOpenAI(
  image: ImageAsset,
  apiKey: string,
  model = "gpt-4o",
  settings: Partial<GenerationSettings> = {},
  signal?: AbortSignal
): Promise<GenerationResult> {
  const fullSettings: GenerationSettings = {
    ...DEFAULT_GENERATION_SETTINGS,
    ...settings,
  };
  const fallback = buildNeutralMetadata();

  const pipeline = await runGenerationPipeline({
    image,
    fallback,
    settings: fullSettings,
    platform: fullSettings.platform,
    call: async (prompt, includeImage = true, dimension) => {
      let imageUrl: string | undefined;
      if (includeImage) {
        const { dataUrl, mimeType } = await getPreparedAnalysis(
          image,
          dimension
        );
        imageUrl = dataUrl.startsWith("data:")
          ? dataUrl
          : `data:${mimeType};base64,${dataUrl}`;
        const imgBase64 = imageUrl.includes(",")
          ? (imageUrl.split(",")[1] ?? "")
          : "";
        if (!imgBase64 || imgBase64.length === 0) {
          throw new GeminiApiError(
            "Image data is empty after preparation. The source image may be corrupted or unsupported.",
            400
          );
        }
      }
      return callOpenAI(prompt, imageUrl, apiKey, model, 0.3, signal);
    },
  });

  return {
    id: crypto.randomUUID(),
    imageId: image.id,
    createdAt: new Date().toISOString(),
    imageName: image.name,
    metadata: applySettings(pipeline.metadata, fullSettings),
    qualityScore: computeQualityScore(pipeline.metadata, pipeline.report),
    timingMs: pipeline.timing,
  };
}

async function callMistral(
  text: string,
  imageUrl: string | undefined,
  apiKey: string,
  model: string,
  temperature: number,
  signal?: AbortSignal
): Promise<string> {
  let response: Response;
  try {
    const content: unknown[] = imageUrl
      ? [
          { type: "text", text },
          { type: "image_url", image_url: { url: imageUrl } },
        ]
      : [{ type: "text", text }];
    response = await fetch(`${MISTRAL_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
      body: JSON.stringify({
        model,
        temperature,
        messages: [{ role: "user", content }],
      }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error("[Mistral] Network error while calling the API", error);
    throw new GeminiApiError(
      error instanceof Error ? error.message : "Network request failed",
      0
    );
  }

  const rawBody = await response.text();
  let data: unknown = null;
  try {
    data = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    data = null;
  }

  console.log(`[Mistral] ${response.status} ${response.statusText}`);

  if (!response.ok) {
    throw buildMistralError(
      data,
      rawBody,
      response.status,
      `API request failed (${response.status})`
    );
  }

  const json = data as
    | { choices?: Array<{ message?: { content?: string } }> }
    | null;
  return json?.choices?.[0]?.message?.content ?? "";
}

export async function generateWithMistral(
  image: ImageAsset,
  apiKey: string,
  model = "pixtral-large-latest",
  settings: Partial<GenerationSettings> = {},
  signal?: AbortSignal
): Promise<GenerationResult> {
  const fullSettings: GenerationSettings = {
    ...DEFAULT_GENERATION_SETTINGS,
    ...settings,
  };
  const fallback = buildNeutralMetadata();

  const pipeline = await runGenerationPipeline({
    image,
    fallback,
    settings: fullSettings,
    platform: fullSettings.platform,
    call: async (prompt, includeImage = true, dimension) => {
      let imageUrl: string | undefined;
      if (includeImage) {
        const { dataUrl, mimeType } = await getPreparedAnalysis(
          image,
          dimension
        );
        imageUrl = dataUrl.startsWith("data:")
          ? dataUrl
          : `data:${mimeType};base64,${dataUrl}`;
        const imgBase64 = imageUrl.includes(",")
          ? (imageUrl.split(",")[1] ?? "")
          : "";
        if (!imgBase64 || imgBase64.length === 0) {
          throw new GeminiApiError(
            "Image data is empty after preparation. The source image may be corrupted or unsupported.",
            400
          );
        }
      }
      return callMistral(prompt, imageUrl, apiKey, model, 0.3, signal);
    },
  });

  return {
    id: crypto.randomUUID(),
    imageId: image.id,
    createdAt: new Date().toISOString(),
    imageName: image.name,
    metadata: applySettings(pipeline.metadata, fullSettings),
    qualityScore: computeQualityScore(pipeline.metadata, pipeline.report),
    timingMs: pipeline.timing,
  };
}
