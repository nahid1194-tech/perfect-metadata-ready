import type {
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
  isValidShutterstockCategories,
} from "@/lib/stock-spec";
import {
  IMAGE_API_MAX_DIMENSION,
  IMAGE_MAX_BYTES,
  compressImageDataUrl,
} from "@/lib/image-process";
import { useAppStore } from "@/store/use-app-store";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const OPENAI_API_BASE = "https://api.openai.com/v1";

export const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

export const OPENAI_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
];

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
      return `Gemini Model Busy. Retrying with another model... — ${raw}`;
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
    ssPrimary.id + (ssSecondary ? `, ${ssSecondary.id}` : "")
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

  const clean = (meta: StockMetadata): { title: string; keywords: string[] } => {
    let title = meta.title;
    for (const term of negativeTitle) {
      title = title.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi"), " ");
    }
    title = title.replace(/\s+/g, " ").trim();
    if (prefix) title = `${prefix} ${title}`;
    if (suffix) title = `${title} ${suffix}`;
    const keywords = meta.keywords.filter(
      (keyword) => !negativeKeywords.includes(keyword.toLowerCase())
    );
    return { title, keywords };
  };

  const adobe = clean(metadata.adobe);
  const shutterstock = clean(metadata.shutterstock);
  const adobeKeywordCount = Math.max(
    1,
    Math.min(settings.keywordCount, ADOBE_KEYWORDS_MAX)
  );
  const shutterstockKeywordCount = Math.max(
    SHUTTERSTOCK_KEYWORDS_MIN,
    Math.min(settings.keywordCount, SHUTTERSTOCK_KEYWORDS_MAX)
  );

  return {
    adobe: {
      ...metadata.adobe,
      title: adobe.title.slice(0, ADOBE_TITLE_MAX),
      description: truncateWords(metadata.adobe.description, settings.descriptionLength),
      keywords: adobe.keywords.slice(0, adobeKeywordCount),
    },
    shutterstock: {
      ...metadata.shutterstock,
      title: shutterstock.title.slice(0, SHUTTERSTOCK_TITLE_MAX),
      description: truncateWords(
        metadata.shutterstock.description,
        Math.min(settings.descriptionLength, SHUTTERSTOCK_TITLE_MAX)
      ),
      keywords: shutterstock.keywords.slice(0, shutterstockKeywordCount),
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
    metadata,
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
      : isValidShutterstockCategories(rawCategory)
        ? rawCategory
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

const ADOBE_CATEGORY_GUIDE = ADOBE_CATEGORIES.map(
  (c) => `${c.id} ${c.label}`
).join(", ");
const SHUTTERSTOCK_CATEGORY_GUIDE = SHUTTERSTOCK_CATEGORIES.map(
  (c) => `${c.id} ${c.label}`
).join(", ");

const VISUAL_ANALYSIS_PROMPT = `You are a meticulous visual analyst for stock photography and vector/design assets. Examine the image region by region and describe ONLY what is clearly visible. Never guess, assume, or invent content - if something is not visible, do not include it and leave the field empty or as an empty array.

Take your time and analyze deeply: primary subject, secondary objects, shapes, colors, texture, style, composition, perspective, lighting, background, graphic elements, design style, and industry relevance.

Reply with ONLY this JSON object (no markdown, no commentary):
{
  "subject": "",
  "style": "",
  "objects": [],
  "colors": [],
  "composition": "",
  "background": "",
  "concepts": [],
  "secondaryObjects": [],
  "shapes": [],
  "texture": "",
  "perspective": "",
  "lighting": "",
  "graphicElements": [],
  "designStyle": "",
  "industryRelevance": "",
  "artworkType": ""
}

Field guidance:
- "subject": the single primary subject, named literally (e.g. "a red vintage bicycle").
- "style": photographic, illustration, 3D render, flat vector, line art, abstract, etc.
- "objects": every clearly visible object, most prominent first.
- "colors": dominant colors, most prominent first (e.g. "teal", "warm beige").
- "composition": arrangement, e.g. centered, rule of thirds, symmetrical, layered, diagonal flow.
- "background": what the background actually shows, or "" if none.
- "concepts": only concepts unambiguously supported by visible content (e.g. for a beach photo: "coastline", "summer"; never "success" or "business" unless literally depicted).
- "graphicElements": visible design elements such as lines, waves, dots, geometric shapes, gradient bands, typography, frames.
- "designStyle": if it is a designed asset, name the design style (minimal, flat, corporate, geometric, hand-drawn, corporate gradient, etc.); otherwise "".
- "industryRelevance": only if the content clearly depicts a specific industry context (e.g. "healthcare" only if medical imagery is visible); otherwise "".
- "artworkType": ONLY one of these if the asset is abstract/vector/designed, otherwise "": abstract background, geometric pattern, fluid shape, brush texture, wave line, gradient mesh, modern banner, minimal poster, brochure cover, presentation background, template, wallpaper, vector illustration.
- "texture", "perspective", "lighting": describe only if clearly visible, otherwise "".

Return ONLY the JSON object.`;

const METADATA_PROMPT = `You are a stock-photography metadata generator for Adobe Stock and Shutterstock. You will receive a visual analysis of an image. Generate the metadata STRICTLY and ONLY from that analysis - the image itself is not available to you, so never invent, guess, or assume any element that is not present in the analysis.

Reply with ONLY this JSON object (no markdown, no commentary):
{"adobe":{"title":"","keywords":[],"category":""},"shutterstock":{"title":"","description":"","keywords":[],"category":""}}

Rules:
- Describe only what is clearly visible in the analysis. Every title, keyword, description term, and concept must trace back to the analysis.
- Keywords must be ranked by visual importance (most important first). Precision over quantity: remove any keyword that is weak, generic, vague, or not visibly present in the image.
- The title must describe exactly what is visible.
- Do NOT use any of these keywords unless the analysis clearly supports them: business, technology, innovation, success, marketing, corporate, digital, solution, strategy, startup, leadership, finance.
- For abstract/vector/designed assets, describe the actual visible design (colours, shapes, lines, gradients, layout) and use the analysis "artworkType" term when naming it, e.g. abstract background, geometric pattern, fluid shape, brush texture, wave line, gradient mesh, modern banner, minimal poster, brochure cover, presentation background, template, wallpaper, vector illustration.
- Adobe: title = brief natural sentence, 60-70 chars, no commas, no technical/gear terms; keywords <=49 unique, ordered by importance (most important first); category = ONE ID from: ${ADOBE_CATEGORY_GUIDE}
- Shutterstock: title + description = natural descriptive headlines covering who/what/where and mood; description <=2048 chars; no links, camera info, trademarks; keywords 7-50 unique; category = 1-2 IDs comma-separated from: ${SHUTTERSTOCK_CATEGORY_GUIDE}
- No trademarks, brands, artist names, real people, or personal data. English only.

BEFORE returning, self-validate: does every keyword exist visually in the analysis? does the title accurately describe the visible content? Remove every weak, generic, or misleading keyword. Precision over quantity.

Return ONLY the JSON object.`;

function buildMetadataPrompt(
  analysisJson: string,
  settingsPrompt: string
): string {
  return `${METADATA_PROMPT}

VISUAL ANALYSIS OF THE IMAGE (the only source of truth - the image itself is NOT provided):
${analysisJson}${settingsPrompt}`;
}

function isValidAnalysis(text: string): boolean {
  try {
    const json = JSON.parse(text);
    return (
      typeof json === "object" &&
      json !== null &&
      !Array.isArray(json) &&
      typeof json.subject === "string"
    );
  } catch {
    return false;
  }
}

function buildSettingsPrompt(settings: GenerationSettings): string {
  const parts: string[] = [
    `Target: ~${settings.titleLength} char title, ~${settings.descriptionLength} char description, ~${settings.keywordCount} keywords.`,
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
  return `\nUser preferences:\n- ${parts.join("\n- ")}`;
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
          generationConfig: { temperature },
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

  console.log("[Gemini] API response", {
    status: response.status,
    statusText: response.statusText,
    body: data ?? rawBody,
  });

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

async function ensureApiImage(
  image: ImageAsset
): Promise<{ dataUrl: string; mimeType: string }> {
  if (image.apiDataUrl && image.apiMimeType) {
    return { dataUrl: image.apiDataUrl, mimeType: image.apiMimeType };
  }
  try {
    const compressed = await compressImageDataUrl(
      image.dataUrl,
      IMAGE_MAX_BYTES,
      IMAGE_API_MAX_DIMENSION
    );
    useAppStore.getState().updateImage(image.id, {
      apiDataUrl: compressed.dataUrl,
      apiMimeType: compressed.mimeType,
    });
    return compressed;
  } catch (error) {
    console.warn(
      "[Image] Could not compress on the fly, sending the original image",
      error
    );
    return { dataUrl: image.dataUrl, mimeType: image.type };
  }
}

async function imageParts(image: ImageAsset): Promise<unknown[]> {
  const { dataUrl, mimeType } = await ensureApiImage(image);
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
  const settingsPrompt = buildSettingsPrompt(fullSettings);

  const parts = await imageParts(image);
  parts.push({ text: VISUAL_ANALYSIS_PROMPT });

  const analysisRaw = await callGemini(
    parts,
    apiKey,
    model,
    0.4,
    signal
  );

  let metadata: GeneratedMetadata;

  if (!isValidAnalysis(extractJson(analysisRaw))) {
    console.warn(
      "[Generate] Visual analysis was not usable, falling back to local metadata"
    );
    metadata = fallback;
  } else {
    const rawText = await callGemini(
      [{ text: buildMetadataPrompt(extractJson(analysisRaw), settingsPrompt) }],
      apiKey,
      model,
      0.7,
      signal
    );

    try {
      const raw = JSON.parse(extractJson(rawText));
      metadata = {
        adobe: normalize(raw?.adobe, fallback.adobe, "adobe"),
        shutterstock: normalize(raw?.shutterstock, fallback.shutterstock, "shutterstock"),
      };
    } catch {
      metadata = fallback;
    }
  }

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

  console.log("[OpenAI] API response", {
    status: response.status,
    statusText: response.statusText,
    body: data ?? rawBody,
  });

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
  const settingsPrompt = buildSettingsPrompt(fullSettings);

  const { dataUrl, mimeType } = await ensureApiImage(image);
  const imageUrl = dataUrl.startsWith("data:")
    ? dataUrl
    : `data:${mimeType};base64,${dataUrl}`;

  const analysisRaw = await callOpenAI(
    VISUAL_ANALYSIS_PROMPT,
    imageUrl,
    apiKey,
    model,
    0.4,
    signal
  );

  let metadata: GeneratedMetadata;

  if (!isValidAnalysis(extractJson(analysisRaw))) {
    console.warn(
      "[Generate] Visual analysis was not usable, falling back to local metadata"
    );
    metadata = fallback;
  } else {
    const rawText = await callOpenAI(
      buildMetadataPrompt(extractJson(analysisRaw), settingsPrompt),
      undefined,
      apiKey,
      model,
      0.7,
      signal
    );

    try {
      const raw = JSON.parse(extractJson(rawText));
      metadata = {
        adobe: normalize(raw?.adobe, fallback.adobe, "adobe"),
        shutterstock: normalize(raw?.shutterstock, fallback.shutterstock, "shutterstock"),
      };
    } catch {
      metadata = fallback;
    }
  }

  return {
    id: crypto.randomUUID(),
    imageId: image.id,
    createdAt: new Date().toISOString(),
    imageName: image.name,
    metadata: applySettings(metadata, fullSettings),
  };
}
