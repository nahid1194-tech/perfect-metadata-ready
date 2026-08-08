import type {
  ApiProvider,
  CsvFormat,
  GeneratedMetadata,
  GenerationResult,
  GenerationSettings,
  ImageAsset,
  StockMetadata,
} from "@/lib/types";
import {
  ADOBE_CATEGORIES,
  ADOBE_KEYWORDS_MAX,
  ADOBE_TITLE_MAX,
  SHUTTERSTOCK_CATEGORIES,
  SHUTTERSTOCK_KEYWORDS_MAX,
  SHUTTERSTOCK_KEYWORDS_MIN,
  SHUTTERSTOCK_TITLE_MAX,
  isValidAdobeCategory,
  normalizeShutterstockCategories,
} from "@/lib/stock-spec";
import { prepareImageForApi } from "@/lib/image-process";
import {
  backgroundRules,
  detectBackground,
  type BackgroundDetection,
} from "@/lib/background";
import { imageContentHash } from "@/lib/cache";
import { createProfiler, logProfile } from "@/lib/perf";

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
};

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slugify(name: string): string {
  return name
    .replace(/\.[^/.]+$/, "")
    .replace(/[_\-\s]+/g, " ")
    .trim();
}

function capitalize(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

const moods = ["serene", "moody", "vibrant", "dramatic", "ethereal"];
const lightings = ["golden hour", "studio softbox", "neon glow", "rim light"];
const styles = [
  "photorealistic",
  "stylized illustration",
  "cinematic still",
  "hyper-detailed digital painting",
];

const conceptKeywords = [
  "high resolution",
  "professional",
  "sharp focus",
  "commercial photography",
  "colorful",
  "creative",
  "detailed",
  "visually appealing",
];

function buildKeywords(
  titleBase: string,
  categoryLabel: string,
  mood: string,
  lighting: string,
  style: string,
  max: number
): string[] {
  const pool = [
    ...titleBase.split(" "),
    categoryLabel,
    mood,
    lighting,
    style,
    ...conceptKeywords,
  ];
  const out: string[] = [];
  for (const item of pool) {
    const clean = item.toLowerCase().replace(/,/g, "").trim();
    if (clean && !out.includes(clean)) out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

function buildAdobe(
  titleBase: string,
  categoryLabel: string,
  category: string,
  mood: string,
  lighting: string,
  style: string
): StockMetadata {
  const words = titleBase.split(" ");
  let candidate = `${words.join(" ")} in ${style} style`;
  while (candidate.length > ADOBE_TITLE_MAX && words.length > 1) {
    words.pop();
    candidate = `${words.join(" ")} in ${style} style`;
  }
  const title = candidate
    .replace(/,/g, "")
    .slice(0, ADOBE_TITLE_MAX)
    .replace(/\s+$/, "");

  const keywords = buildKeywords(
    titleBase,
    categoryLabel,
    mood,
    lighting,
    style,
    ADOBE_KEYWORDS_MAX
  );

  return {
    title,
    description: "",
    keywords,
    category,
  };
}

function buildShutterstock(
  titleBase: string,
  categoryLabel: string,
  category: string,
  mood: string,
  lighting: string,
  style: string
): StockMetadata {
  const title = `${capitalize(titleBase)} in a ${mood} ${style} scene with ${lighting} lighting`;

  const keywords = buildKeywords(
    titleBase,
    categoryLabel,
    mood,
    lighting,
    style,
    SHUTTERSTOCK_KEYWORDS_MAX
  );
  while (keywords.length < SHUTTERSTOCK_KEYWORDS_MIN) {
    const extra = ["background", "scene", "composition"];
    for (const item of extra) {
      if (keywords.length >= SHUTTERSTOCK_KEYWORDS_MIN) break;
      if (!keywords.includes(item)) keywords.push(item);
    }
  }

  return {
    title,
    description: `${title}. The ${mood} atmosphere and ${lighting} lighting create a ${style} look suited for advertising, editorial, and web use.`,
    keywords,
    category,
  };
}

function buildMetadata(image: ImageAsset, seed: number): GeneratedMetadata {
  const rand = mulberry32(seed);
  const subject =
    slugify(image.name).split(" ").slice(0, 3).join(" ") || "untitled subject";
  const titleBase = capitalize(subject);
  const mood = moods[Math.floor(rand() * moods.length)];
  const lighting = lightings[Math.floor(rand() * lightings.length)];
  const style = styles[Math.floor(rand() * styles.length)];

  const adobeCategory =
    ADOBE_CATEGORIES[Math.floor(rand() * ADOBE_CATEGORIES.length)];
  const ssPrimary =
    SHUTTERSTOCK_CATEGORIES[
      Math.floor(rand() * SHUTTERSTOCK_CATEGORIES.length)
    ];
  const ssSecondary =
    rand() < 0.5
      ? SHUTTERSTOCK_CATEGORIES[
          Math.floor(rand() * SHUTTERSTOCK_CATEGORIES.length)
        ]
      : null;
  const ssCategories = String(
    ssPrimary.label + (ssSecondary ? `, ${ssSecondary.label}` : "")
  );

  return {
    adobe: buildAdobe(
      titleBase,
      adobeCategory.label,
      String(adobeCategory.id),
      mood,
      lighting,
      style
    ),
    shutterstock: buildShutterstock(
      titleBase,
      ssPrimary.label,
      ssCategories,
      mood,
      lighting,
      style
    ),
  };
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
    ...conceptKeywords,
  ];
}

function enforceKeywords(values: string[], pool: string[], target: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.replace(/,/g, "").replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (!clean || key.length < 3) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= target) break;
  }
  for (const value of pool) {
    const clean = value.replace(/,/g, "").replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (!clean || key.length < 3) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= target) break;
  }
  return out.slice(0, target);
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
      keywords: enforceKeywords(
        adobeKeywords,
        buildKeywordPool(metadata.adobe),
        adobeKeywordCount
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
      keywords: enforceKeywords(
        shutterstockKeywords,
        buildKeywordPool(metadata.shutterstock),
        shutterstockKeywordCount
      ),
    },
  };
}

export function generateLocal(
  image: ImageAsset,
  settings: Partial<GenerationSettings> = {}
): GenerationResult {
  const fullSettings: GenerationSettings = {
    ...DEFAULT_GENERATION_SETTINGS,
    ...settings,
  };
  const seed = hashString(image.name + image.size);
  const metadata = applySettings(buildMetadata(image, seed), fullSettings);
  return {
    id: crypto.randomUUID(),
    imageId: image.id,
    createdAt: new Date().toISOString(),
    imageName: image.name,
    metadata: applySettings(metadata, fullSettings),
  };
}

function sanitizeKeywords(
  value: unknown,
  max: number,
  fallback: string[]
): string[] {
  const cleaned = Array.isArray(value)
    ? value
        .map(String)
        .map((keyword) => keyword.replace(/,/g, "").trim())
        .filter(Boolean)
    : [];
  const out: string[] = [];
  for (const keyword of cleaned) {
    if (!out.includes(keyword)) out.push(keyword);
    if (out.length >= max) break;
  }
  if (out.length < SHUTTERSTOCK_KEYWORDS_MIN) {
    for (const keyword of fallback) {
      if (out.length >= SHUTTERSTOCK_KEYWORDS_MIN) break;
      if (!out.includes(keyword)) out.push(keyword);
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

  const title = String(value.title ?? "").trim();
  const description = String(value.description ?? "").trim();
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

const ADOBE_CATEGORY_GUIDE = ADOBE_CATEGORIES.map(
  (c) => `${c.id} ${c.label}`
).join(", ");
const SHUTTERSTOCK_CATEGORY_GUIDE = SHUTTERSTOCK_CATEGORIES.map(
  (c) => c.label
).join(", ");

const SINGLE_SHOT_PROMPT = `You are an expert Adobe Stock and Shutterstock metadata generator. Look at the image and produce accurate, specific, commercially useful metadata. Only describe what is clearly visible. Never invent objects, text, logos, brands, people's names, or other copyrighted content.

Reply with ONLY this exact JSON (no markdown, no comments, no extra fields):
{"adobe":{"title":"","keywords":[],"category":""},"shutterstock":{"title":"","description":"","keywords":[],"category":""}}

RULES
- TITLE: specific, natural English; main subject + setting + key details; no filler or keyword stuffing. Must NEVER exceed the character limit from USER PREFERENCES and must ALWAYS end on a complete word. If the title is too long, rewrite it more concisely — never cut or truncate a word.
- KEYWORDS: exactly the number specified in USER PREFERENCES (the count must match exactly). Complete, correctly spelled words or short phrases; prefer singular; no duplicates; no truncated words; drop generic filler (beautiful, background, concept, design, art, photo, image, high quality, etc.); never use brands, logos, trademarks, or artist names. Order by buyer intent (most searched first).
- adobe.title: no commas. adobe.category: the single numeric ID whose label best fits, from this list (ID Label): {ADOBE}
- shutterstock.description: 1-2 factual sentences (subject, setting, action, mood); no marketing language.
- shutterstock.category: 1-2 exact official category names from this list: {SS}
- gender, ethnicity, age, and profession terms ONLY when clearly visible.
- Before finalizing, self-check: is the keyword count exactly as requested? does every keyword reflect visible content? is the title within the character limit and ending on a complete word? fix anything that fails.`;

function buildSingleShotPrompt(
  settings: GenerationSettings,
  bgRules: string
): string {
  const base = SINGLE_SHOT_PROMPT.replace("{ADOBE}", ADOBE_CATEGORY_GUIDE).replace(
    "{SS}",
    SHUTTERSTOCK_CATEGORY_GUIDE
  );
  return `${base}

VERIFIED BACKGROUND FACTS (from pixel analysis - keep consistent):
${bgRules}

USER PREFERENCES:
- ${buildSettingsPrompt(settings)}

Return ONLY the JSON.`;
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

type PreparedAnalysis = {
  dataUrl: string;
  mimeType: string;
  background: BackgroundDetection;
};

const preparedAnalysisCache = new Map<string, Promise<PreparedAnalysis>>();

async function getPreparedAnalysis(image: ImageAsset): Promise<PreparedAnalysis> {
  const cached = preparedAnalysisCache.get(image.id);
  if (cached) return cached;
  const promise = (async () => {
    const profiler = createProfiler();
    profiler.start("prep");
    const prepared = await prepareImageForApi(image);
    profiler.mark("prepared");
    const background = await detectBackground(prepared.dataUrl);
    profiler.end("bg");
    logProfile(`${image.name}:prepare`, profiler.result());
    return { ...prepared, background };
  })();
  preparedAnalysisCache.set(image.id, promise);
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
  call: (prompt: string) => Promise<string>;
}): Promise<GeneratedMetadata> {
  const { image, fallback, settings, call } = args;
  const profiler = createProfiler();

  const { background } = await getPreparedAnalysis(image);
  const bgRules = backgroundRules(background);
  const prompt = buildSingleShotPrompt(settings, bgRules);

  profiler.start("request");
  const raw = await call(prompt);
  profiler.end("request");

  const parsed = parseMetadata(raw);
  if (!parsed) {
    console.warn(
      "[Generate] Metadata parse failed, falling back to local metadata"
    );
    return fallback;
  }

  profiler.start("normalize");
  const metadata: GeneratedMetadata = {
    adobe: normalize(parsed.adobe, fallback.adobe, "adobe"),
    shutterstock: normalize(
      parsed.shutterstock,
      fallback.shutterstock,
      "shutterstock"
    ),
  };
  profiler.end("normalize");
  logProfile(`${image.name}:generate`, profiler.result());
  return metadata;
}

function buildSettingsPrompt(settings: GenerationSettings): string {
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
  const parts: string[] = [
    `Title length: exactly ${adobeTitleMax} characters or fewer for adobe.title and exactly ${shutterstockTitleMax} characters or fewer for shutterstock.title. Never exceed the limit and always end on a complete word; if too long, rewrite the title shorter.`,
    `Keywords: adobe.keywords must contain EXACTLY ${adobeKeywordCount} unique keywords and shutterstock.keywords must contain EXACTLY ${shutterstockKeywordCount} unique keywords.`,
    `Description: up to ${settings.descriptionLength} characters.`,
  ];
  if (settings.enablePrefix && settings.prefix.trim()) {
    parts.push(`Prefix every title with: "${settings.prefix.trim()}"`);
  }
  if (settings.enableSuffix && settings.suffix.trim()) {
    parts.push(`Suffix every title with: "${settings.suffix.trim()}"`);
  }
  if (settings.enableNegativeTitleWords && settings.negativeTitleWords.trim()) {
    parts.push(`Never use in titles: ${settings.negativeTitleWords.trim()}`);
  }
  if (settings.enableNegativeKeywords && settings.negativeKeywords.trim()) {
    parts.push(`Never use as keywords: ${settings.negativeKeywords.trim()}`);
  }
  return parts.join("\n- ");
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text;
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

async function analysisImageParts(image: ImageAsset): Promise<unknown[]> {
  const { dataUrl, mimeType } = await getPreparedAnalysis(image);
  const base64 = dataUrl.split(",")[1] ?? dataUrl;
  return [{ inline_data: { mime_type: mimeType, data: base64 } }];
}

export async function generateWithApi(
  image: ImageAsset,
  apiKey: string,
  model = "gemini-2.5-flash",
  settings: Partial<GenerationSettings> = {},
  signal?: AbortSignal
): Promise<GenerationResult> {
  const fullSettings: GenerationSettings = {
    ...DEFAULT_GENERATION_SETTINGS,
    ...settings,
  };
  const seed = hashString(image.name + image.size);
  const fallback = buildMetadata(image, seed);

  const metadata = await runGenerationPipeline({
    image,
    fallback,
    settings: fullSettings,
    call: async (prompt) => {
      const parts = await analysisImageParts(image);
      parts.push({ text: prompt });
      return callGemini(parts, apiKey, model, 0.3, signal);
    },
  });

  return {
    id: crypto.randomUUID(),
    imageId: image.id,
    createdAt: new Date().toISOString(),
    imageName: image.name,
    metadata: applySettings(metadata, fullSettings),
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
  const seed = hashString(image.name + image.size);
  const fallback = buildMetadata(image, seed);

  const metadata = await runGenerationPipeline({
    image,
    fallback,
    settings: fullSettings,
    call: async (prompt) => {
      const { dataUrl, mimeType } = await getPreparedAnalysis(image);
      const imageUrl = dataUrl.startsWith("data:")
        ? dataUrl
        : `data:${mimeType};base64,${dataUrl}`;
      return callOpenAI(prompt, imageUrl, apiKey, model, 0.3, signal);
    },
  });

  return {
    id: crypto.randomUUID(),
    imageId: image.id,
    createdAt: new Date().toISOString(),
    imageName: image.name,
    metadata: applySettings(metadata, fullSettings),
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
  const seed = hashString(image.name + image.size);
  const fallback = buildMetadata(image, seed);

  const metadata = await runGenerationPipeline({
    image,
    fallback,
    settings: fullSettings,
    call: async (prompt) => {
      const { dataUrl, mimeType } = await getPreparedAnalysis(image);
      const imageUrl = dataUrl.startsWith("data:")
        ? dataUrl
        : `data:${mimeType};base64,${dataUrl}`;
      return callMistral(prompt, imageUrl, apiKey, model, 0.3, signal);
    },
  });

  return {
    id: crypto.randomUUID(),
    imageId: image.id,
    createdAt: new Date().toISOString(),
    imageName: image.name,
    metadata: applySettings(metadata, fullSettings),
  };
}
