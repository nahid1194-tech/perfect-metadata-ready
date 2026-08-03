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
import {
  backgroundRules,
  describeBackground,
  detectBackground,
} from "@/lib/background";
import {
  noteProviderRateLimit,
  noteProviderSuccess,
  waitForProviderSlot,
} from "@/lib/rate-limiter";
import { useAppStore } from "@/store/use-app-store";

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
  generationSpeed: "smart",
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
  (c) => `${c.id} ${c.label}`
).join(", ");

const VISUAL_ANALYSIS_PROMPT = `You are a meticulous visual analyst for professional stock photography and vector/design assets. Examine the image region by region and zoom into fine details. Describe ONLY what is clearly visible. Never guess, assume, or invent content - if something is not clearly visible, leave the field empty ("" or []).

Cover every category that applies: primary subject, secondary subjects, small objects, human count, gender, age group, facial expressions, pose, clothing, accessories, animals, plants, food, vehicles, buildings, furniture, technology devices, nature elements, sky, water, foreground, background, colors, materials, texture, lighting, shadows, reflection, camera angle, composition, copy space, depth of field, focus, graphic elements, shapes, pattern, style, mood, emotion, commercial concepts, OCR text, logos, brands, landmarks, and background detection (transparent / white / black / studio / isolated).

Do NOT generate any metadata in this stage - only return the structured analysis object.

Return ONLY this structured analysis object (JSON, no markdown, no commentary):
{
  "subject": "",
  "objects": [],
  "secondarySubjects": [],
  "smallObjects": [],
  "humanCount": 0,
  "gender": [],
  "ageGroup": [],
  "facialExpressions": [],
  "pose": [],
  "clothing": [],
  "accessories": [],
  "animals": [],
  "plants": [],
  "food": [],
  "vehicles": [],
  "buildings": [],
  "furniture": [],
  "technologyDevices": [],
  "natureElements": [],
  "sky": "",
  "water": "",
  "foreground": "",
  "background": "",
  "backgroundType": "",
  "backgroundColors": [],
  "colors": [],
  "lighting": "",
  "shadows": "",
  "reflections": [],
  "materials": [],
  "textures": [],
  "cameraAngle": "",
  "composition": "",
  "copySpace": false,
  "copySpaceLocation": "",
  "depthOfField": "",
  "focus": "",
  "perspective": "",
  "environment": "",
  "season": "",
  "weather": "",
  "style": "",
  "mood": "",
  "emotion": "",
  "commercialConcepts": [],
  "graphicElements": [],
  "shapes": [],
  "patterns": [],
  "icons": [],
  "text": [],
  "logos": [],
  "brands": [],
  "landmarks": [],
  "concepts": [],
  "designStyle": "",
  "industryRelevance": "",
  "artworkType": "",
  "transparent": false,
  "whiteBackground": false,
  "blackBackground": false,
  "studioBackground": false,
  "isolated": false
}

Field guidance:
- "subject": the single primary subject, named literally (e.g. "a red vintage bicycle").
- "objects": every clearly visible object, most prominent first.
- "secondarySubjects": other clearly visible subjects (e.g. "a wooden crate", "trees in the distance").
- "smallObjects": small but clearly visible details (e.g. "a door handle", "a leaf on the ground").
- "humanCount": the exact number of clearly visible people; 0 if none.
- "gender": visible gender(s), e.g. ["male", "female"] - only if clearly visible.
- "ageGroup": visible age group(s), e.g. ["child", "adult"], ["teenager"], ["senior"] - only if clearly visible.
- "facialExpressions": visible expressions (e.g. "smiling", "neutral") - only if a face is clearly visible.
- "pose": visible body poses (e.g. "standing", "sitting", "running", "jumping").
- "clothing": visible clothing on people (e.g. "white linen shirt, blue jeans").
- "accessories": visible accessories (e.g. "eyeglasses", "hat", "backpack", "watch", "jewelry").
- "animals": clearly visible animals.
- "plants": clearly visible plants (trees, flowers, grass).
- "food": clearly visible food or drinks.
- "vehicles": clearly visible vehicles (cars, bikes, boats, planes).
- "buildings": clearly visible buildings or architecture.
- "furniture": clearly visible furniture (chairs, tables, sofas).
- "technologyDevices": clearly visible tech devices (laptop, smartphone, camera, computer).
- "natureElements": clearly visible natural elements (rocks, mountains, clouds, sand, snow).
- "sky": describe the visible sky (e.g. "clear blue sky", "stormy clouds"), or "" if none.
- "water": describe the visible water (e.g. "calm ocean", "rippling lake"), or "" if none.
- "foreground": what fills the foreground (e.g. "out-of-focus grass blades").
- "background": exactly what the background shows (e.g. "blurred city street at dusk").
- "backgroundType": ONLY one of: transparent, white, black, isolated, studio, solidColor, natural, other. A scene with depth is "natural".
- "backgroundColors": dominant colors of the background.
- "colors": dominant colors of the whole image, most prominent first (e.g. "teal", "warm beige").
- "lighting": e.g. "soft window light", "hard flash", "golden hour sun", "studio softbox", "backlit", "neon glow".
- "shadows": visible shadows (e.g. "soft drop shadow under the bottle").
- "reflections": visible reflections (water, glass, mirror, glossy surfaces).
- "materials": visible materials (e.g. "steel", "wood", "canvas", "leather", "glass").
- "textures": visible textures (e.g. "rough concrete", "glossy plastic", "woven fabric").
- "cameraAngle": e.g. "eye-level", "high angle", "low angle", "top-down".
- "composition": e.g. "centered", "rule of thirds", "symmetrical", "layered", "diagonal flow", "frame-in-frame".
- "copySpace": true only if a plain empty area suitable for text is clearly visible.
- "copySpaceLocation": where the copy space is (e.g. "top-left corner"), or "" if none.
- "depthOfField": e.g. "shallow", "deep", "blurred background".
- "focus": where the image is sharpest (e.g. "sharp focus on the subject's eyes").
- "perspective": e.g. "one-point perspective", "flat", "isometric", "top-down".
- "environment": the setting (e.g. "modern kitchen", "coastal cliff", "abstract digital canvas").
- "season": only if clearly depicted (e.g. "winter", "autumn"); otherwise "".
- "weather": only if clearly depicted (e.g. "sunny", "rainy", "foggy"); otherwise "".
- "style": e.g. "photographic", "illustration", "3D render", "flat vector", "line art", "abstract", "watercolor".
- "mood": the overall mood conveyed by visible cues (e.g. "calm", "energetic", "serene", "dramatic").
- "emotion": emotions shown by visible people, if any.
- "commercialConcepts": commercial usage concepts ONLY if visually supported (e.g. a clean workspace: "corporate", "office"; fresh food: "catering", "restaurant").
- "graphicElements": visible design elements (lines, waves, dots, geometric shapes, gradient bands, frames, typography).
- "shapes": visible shapes.
- "patterns": visible repeating patterns.
- "icons": visible icons or symbols and what they represent.
- "text": transcribe every legible visible text exactly (e.g. "COFFEE"); for partial labels transcribe the legible part.
- "logos": note any visible logos and what they appear on (do not assume the brand name unless clearly legible).
- "brands": visible brand names only if clearly legible; trademarks are excluded from metadata.
- "landmarks": recognizable landmarks or notable architecture only if clearly identifiable.
- "concepts": only concepts unambiguously supported by visible content (e.g. for a beach photo: "coastline", "summer"; never "success" or "business" unless literally depicted).
- "designStyle": if it is a designed asset, name the design style (minimal, flat, corporate, geometric, hand-drawn, gradient, etc.); otherwise "".
- "industryRelevance": only if the content clearly depicts a specific industry context (e.g. "healthcare" only if medical imagery is visible); otherwise "".
- "artworkType": ONLY one of these if the asset is abstract/vector/designed, otherwise "": abstract background, geometric pattern, fluid shape, brush texture, wave line, gradient mesh, modern banner, minimal poster, brochure cover, presentation background, template, wallpaper, vector illustration.
- "transparent": true only if the background is truly transparent.
- "whiteBackground": true only if the background is plain white.
- "blackBackground": true only if the background is plain black.
- "studioBackground": true only if the background is a professional studio backdrop (seamless, often gray or colored).
- "isolated": true only if the subject is cut out / isolated against a plain background.

The VERIFIED GROUND-TRUTH FACTS section below was computed by pixel analysis - set the matching background booleans (transparent, whiteBackground, blackBackground, isolated) exactly as stated, choose "backgroundType" consistently, and never contradict them.

Return ONLY the JSON object.`;

const METADATA_PROMPT = `You are a professional stock-metadata generator for Adobe Stock and Shutterstock. You receive a deep visual analysis of an image plus verified ground-truth facts. Generate the metadata STRICTLY and ONLY from that information - the image itself is not available to you, so never invent, guess, or assume any element that is not present in the input.

Reply with ONLY this JSON object (no markdown, no commentary):
{"adobe":{"title":"","keywords":[],"category":""},"shutterstock":{"title":"","description":"","keywords":[],"category":""}}

TRUTHFULNESS (highest priority):
- Every title, keyword, description term, and concept must trace back to the analysis and the ground-truth facts.
- Never add objects that are not visible. Never guess, hallucinate, or describe invisible concepts.
- No misleading metadata, no copyright or trademark violations, no real people, brands, artist names, or personal data. English only.

KEYWORDS:
- Only highly relevant, specific, searchable terms, ranked by importance (most important first).
- The first 10 keywords must represent the main subject.
- Prefer singular forms where natural (e.g. "cat" not "cats").
- No duplicates. Remove weak, generic, or vague keywords (e.g. background, illustration, design, art, beautiful, nice, photo, image, concept, high quality, etc.) unless strictly required by visible content.
- Add commercial search terms ONLY if visually supported (use the analysis "commercialConcepts" list); never invent them.
- Never use brand names, logos, trademarks, or artist names as keywords even if a logo is clearly visible.
- Never use these unless the analysis clearly supports them: business, technology, innovation, success, marketing, corporate, digital, solution, strategy, startup, leadership, finance.
- For abstract/vector/designed assets, describe the actual visible design (colours, shapes, lines, gradients, layout) and use the analysis "artworkType" term when naming it, e.g. abstract background, geometric pattern, fluid shape, brush texture, wave line, gradient mesh, modern banner, minimal poster, brochure cover, presentation background, template, wallpaper, vector illustration.

TITLES:
- Natural, readable English. Describe the exact visible subject and the most important visible details.
- Follow Adobe Stock and Shutterstock title guidelines. No keyword stuffing, no misleading information.

DESCRIPTION (Shutterstock only):
- Accurate and natural. Summarize the visible image. No marketing language, no unnecessary adjectives, no links, camera info, or trademarks.

PLATFORM RULES:
- Adobe: title 60-70 characters, no commas; keywords <=49 unique; category = ONE ID from: ${ADOBE_CATEGORY_GUIDE}
- Shutterstock: title <=2048 chars; description <=2048 chars; keywords 7-50 unique; category = 1-2 IDs comma-separated from: ${SHUTTERSTOCK_CATEGORY_GUIDE}

BEFORE returning, self-validate: does every keyword exist visually in the analysis? does the title accurately describe the visible content? does the description summarize only visible content? Remove every weak, generic, or misleading keyword. Precision over quantity.

Return ONLY the JSON object.`;

function buildMetadataPrompt(
  analysisJson: string,
  settingsPrompt: string,
  backgroundRules: string,
  feedback: string
): string {
  return `${METADATA_PROMPT}

BACKGROUND RULES (follow exactly; based on verified ground-truth facts):
${backgroundRules}

VISUAL ANALYSIS OF THE IMAGE (the only source of truth - the image itself is NOT provided):
${analysisJson}${settingsPrompt}${feedback}`;
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

const VALIDATION_MIN_SCORE = 95;
const VALIDATION_MAX_ATTEMPTS = 3;

function buildValidationPrompt(
  analysisJson: string,
  metadata: GeneratedMetadata,
  backgroundHint: string
): string {
  return `You are a strict quality-control reviewer for Adobe Stock / Shutterstock metadata. Compare the generated metadata against the visual analysis and verified ground-truth facts, and score how well it meets the checklist.

GROUND-TRUTH FACTS:
${backgroundHint}

VISUAL ANALYSIS:
${analysisJson}

GENERATED METADATA:
${JSON.stringify(metadata)}

CHECKLIST (score 0-100, be strict):
1. Every keyword is relevant and present in the analysis - no hallucinated or invisible concepts.
2. Keywords are SEO-friendly, ranked by importance, first 10 = main subject, singular forms preferred, no duplicates, no weak/generic terms.
3. Commercial search terms appear only if visually supported (from the analysis "commercialConcepts"); no invented concepts.
4. The title accurately describes the visible subject without keyword stuffing or misleading info.
5. The Shutterstock description is accurate, natural, and free of marketing language.
6. Adobe/Shutterstock guidelines are followed (title lengths, keyword limits, valid category IDs).
7. No copyright, trademark, brand, or real-person violations (logos may be visible but never become keywords).
8. The background description and flags (transparent vs white vs black vs solid vs real scene) match the ground-truth facts and the analysis.
9. Metadata is commercially useful and professional.

Reply with ONLY this JSON object (no markdown, no commentary):
{"score": 0-100, "issues": ["..."]}

If the score is below 95, list the exact fixes the generator must apply in "issues". If the score is 95 or above, return "issues": [].
Return ONLY the JSON object.`;
}

function parseValidation(text: string): { score: number; issues: string[] } {
  try {
    const json = JSON.parse(extractJson(text)) as {
      score?: unknown;
      issues?: unknown;
    } | null;
    const score =
      json && typeof json.score === "number" ? json.score : 0;
    const issues =
      json && Array.isArray(json.issues) ? json.issues.map(String) : [];
    return { score, issues };
  } catch {
    return { score: 0, issues: [] };
  }
}

function formatFeedback(issues: string[]): string {
  if (issues.length === 0) return "";
  return `\nPrevious validation feedback - fix these specific problems on the next attempt:
- ${issues.join("\n- ")}`;
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

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor(payload.length * 0.75);
}

async function ensureAnalysisImage(
  image: ImageAsset
): Promise<{ dataUrl: string; mimeType: string }> {
  const isRasterSource = /^data:image\/(?!svg\+xml)/i.test(image.dataUrl);
  if (isRasterSource && estimateDataUrlBytes(image.dataUrl) <= IMAGE_MAX_BYTES) {
    return {
      dataUrl: image.dataUrl,
      mimeType: image.type.startsWith("image/") ? image.type : "image/png",
    };
  }
  return ensureApiImage(image);
}

async function runGenerationPipeline(args: {
  image: ImageAsset;
  fallback: GeneratedMetadata;
  settings: GenerationSettings;
  callAnalysis: (prompt: string) => Promise<string>;
  callText: (prompt: string, temperature: number) => Promise<string>;
}): Promise<GeneratedMetadata> {
  const { image, fallback, settings, callAnalysis, callText } = args;
  const settingsPrompt = buildSettingsPrompt(settings);

  let backgroundSource = image.dataUrl;
  try {
    backgroundSource = (await ensureAnalysisImage(image)).dataUrl;
  } catch {
    // keep the original data URL
  }
  const background = await detectBackground(backgroundSource);
  const backgroundHint = describeBackground(background);
  const bgRules = backgroundRules(background);

  const analysisRaw = await callAnalysis(
    `${VISUAL_ANALYSIS_PROMPT}

VERIFIED GROUND-TRUTH FACTS (pixel analysis already performed - do not contradict these):
${backgroundHint}`
  );

  if (!isValidAnalysis(extractJson(analysisRaw))) {
    console.warn(
      "[Generate] Visual analysis was not usable, falling back to local metadata"
    );
    return fallback;
  }

  const analysisJson = extractJson(analysisRaw);
  let metadata: GeneratedMetadata = fallback;
  let bestScore = -1;
  let feedback = "";

  for (let attempt = 0; attempt < VALIDATION_MAX_ATTEMPTS; attempt++) {
    const metaRaw = await callText(
      buildMetadataPrompt(analysisJson, settingsPrompt, bgRules, feedback),
      0.7
    );
    const candidate = parseMetadata(metaRaw);
    if (!candidate) {
      console.warn(
        "[Generate] Metadata parse failed on attempt",
        attempt + 1
      );
      continue;
    }
    const parsed: GeneratedMetadata = {
      adobe: normalize(candidate.adobe, fallback.adobe, "adobe"),
      shutterstock: normalize(
        candidate.shutterstock,
        fallback.shutterstock,
        "shutterstock"
      ),
    };

    const validationRaw = await callText(
      buildValidationPrompt(analysisJson, parsed, backgroundHint),
      0.0
    );
    const { score, issues } = parseValidation(validationRaw);
    console.log(
      `[Generate] Validation score: ${score}/100 (attempt ${attempt + 1})`
    );
    if (score > bestScore) {
      bestScore = score;
      metadata = parsed;
    }
    if (score >= VALIDATION_MIN_SCORE) break;
    feedback = formatFeedback(issues);
  }

  return metadata;
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
  await waitForProviderSlot("gemini", signal);
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
    const error = buildApiError(
      data,
      rawBody,
      response.status,
      `API request failed (${response.status})`,
      response.headers.get("retry-after")
    );
    if (isRateLimited(error)) noteProviderRateLimit("gemini");
    throw error;
  }

  noteProviderSuccess("gemini");
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

async function analysisImageParts(image: ImageAsset): Promise<unknown[]> {
  const { dataUrl, mimeType } = await ensureAnalysisImage(image);
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
    callAnalysis: async (prompt) => {
      const parts = await analysisImageParts(image);
      parts.push({ text: prompt });
      return callGemini(parts, apiKey, model, 0.4, signal);
    },
    callText: (prompt, temperature) =>
      callGemini([{ text: prompt }], apiKey, model, temperature, signal),
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
  await waitForProviderSlot("openai", signal);
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
    const error = buildOpenAIError(
      data,
      rawBody,
      response.status,
      `API request failed (${response.status})`
    );
    if (isRateLimited(error)) noteProviderRateLimit("openai");
    throw error;
  }

  noteProviderSuccess("openai");
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
    callAnalysis: async (prompt) => {
      const { dataUrl, mimeType } = await ensureAnalysisImage(image);
      const imageUrl = dataUrl.startsWith("data:")
        ? dataUrl
        : `data:${mimeType};base64,${dataUrl}`;
      return callOpenAI(prompt, imageUrl, apiKey, model, 0.4, signal);
    },
    callText: (prompt, temperature) =>
      callOpenAI(prompt, undefined, apiKey, model, temperature, signal),
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
  await waitForProviderSlot("mistral", signal);
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

  console.log("[Mistral] API response", {
    status: response.status,
    statusText: response.statusText,
    body: data ?? rawBody,
  });

  if (!response.ok) {
    const error = buildMistralError(
      data,
      rawBody,
      response.status,
      `API request failed (${response.status})`
    );
    if (isRateLimited(error)) noteProviderRateLimit("mistral");
    throw error;
  }

  noteProviderSuccess("mistral");
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
    callAnalysis: async (prompt) => {
      const { dataUrl, mimeType } = await ensureAnalysisImage(image);
      const imageUrl = dataUrl.startsWith("data:")
        ? dataUrl
        : `data:${mimeType};base64,${dataUrl}`;
      return callMistral(prompt, imageUrl, apiKey, model, 0.4, signal);
    },
    callText: (prompt, temperature) =>
      callMistral(prompt, undefined, apiKey, model, temperature, signal),
  });

  return {
    id: crypto.randomUUID(),
    imageId: image.id,
    createdAt: new Date().toISOString(),
    imageName: image.name,
    metadata: applySettings(metadata, fullSettings),
  };
}
