#!/usr/bin/env node
/**
 * Gemini Batch SEO Metadata Generator
 *
 * Generates SEO-optimized titles (<= 70 chars) and exactly N keywords (default 49)
 * per image for Adobe Stock / Shutterstock using the Gemini 1.5 Flash model
 * (free tier) with multiple API keys, automatic rate-limit key rotation,
 * per-key throttling, a resumable queue, and graceful Ctrl+C stop.
 *
 * USAGE
 *   node tools/gemini-batch-metadata.mjs <images-or-folders...> [options]
 *
 * OPTIONS
 *   --keys k1,k2,k3    Gemini API keys (default: env GEMINI_API_KEYS or GEMINI_API_KEY)
 *   --model NAME       Model id (default: gemini-3.6-flash)
 *   --delay SECONDS    Min interval between requests per key (default: 1.8)
 *   --keywords N       Exact tag count, 1..49 (default: 49)
 *   --max-retries N    Retries per image (default: 4)
 *   --out FILE         CSV output (default: metadata-results.csv)
 *   --json FILE        JSON output (default: metadata-results.json)
 *   --state FILE       Queue/resume state file (default: .batch-state.json)
 *   --resume           Resume from the state file, skipping completed images
 *   --dry-run          Scan and plan the queue without calling the API
 *   --self-test        Run internal checks (no API) and exit
 *   -h, --help         Show this help
 *
 * EXAMPLES
 *   node tools/gemini-batch-metadata.mjs ./images --keys AIza...,AIza... --delay 1.8
 *   node tools/gemini-batch-metadata.mjs ./images --keys AIza... --keywords 49 --resume
 *
 * NOTES
 *   - Ctrl+C stops cleanly: the current image's result is kept, progress is saved,
 *     and rerunning with --resume continues where it left off.
 *   - Gemini 1.5 Flash free tier allows roughly 15 requests/minute per key.
 *     Requests are spread across keys (per-key --delay), and HTTP 429 responses
 *     automatically rotate to the next available key with a cooldown.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  extname,
  join,
  resolve,
} from "node:path";

const DEFAULT_MODEL = "gemini-3.6-flash";
const DEFAULT_KEYWORD_COUNT = 49;
const MAX_TITLE_CHARS = 70;
const DEFAULT_DELAY_MS = 1800;
const DEFAULT_RETRIES = 4;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 90_000;

const SUPPORTED_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
]);

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

const CONNECTOR_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "of", "on", "in", "with",
  "at", "to", "from", "by", "as", "is", "are", "so", "but", "nor",
]);

const FALLBACK_IDENTIFIERS = [
  "isolated", "transparent background", "white background", "black background",
  "vector", "icon", "template", "minimalist", "flat design", "hand-drawn",
  "line art", "PNG", "high resolution", "color image", "full frame", "graphic",
  "illustration", "texture", "pattern", "web design", "branding", "advertising",
  "social media", "print", "digital",
];

const PROMPT = `Analyze this image and generate professional SEO metadata for Adobe Stock and Shutterstock.

Return ONLY JSON (no markdown, no code fences, no extra text) in this exact shape:
{"title":"...","tags":"tag1, tag2, tag3, ..."}

TITLE RULES
- Concise, descriptive, natural English, under 70 characters (never a keyword list).
- Focus on subject, style, and utility. Put the primary subject in the first 4-7 words.
- No commas in the title.

TAG RULES
- Exactly 49 tags separated by commas, ordered by relevance (strongest first).
- Balanced mix: primary subject keywords, descriptive long-tail phrases, and
  technical/style terms (e.g. vector, isolated, template, minimalist,
  transparent background).
- Only describe what is clearly visible. No keyword stuffing, no brands, no
  logos, no duplicates, no truncated words. Use complete, correctly spelled terms.`;

const HELP = `Gemini Batch SEO Metadata Generator

Usage:
  node tools/gemini-batch-metadata.mjs <images-or-folders...> [options]

Options:
  --keys k1,k2,k3     Gemini API keys (default: GEMINI_API_KEYS or GEMINI_API_KEY env)
  --model NAME        Model id (default: ${DEFAULT_MODEL})
  --delay SECONDS     Min interval between requests per key (default: ${DEFAULT_DELAY_MS / 1000})
  --keywords N        Exact tag count, 1..49 (default: ${DEFAULT_KEYWORD_COUNT})
  --max-retries N     Retries per image (default: ${DEFAULT_RETRIES})
  --out FILE          CSV output (default: metadata-results.csv)
  --json FILE         JSON output (default: metadata-results.json)
  --state FILE        Queue/resume state file (default: .batch-state.json)
  --resume            Resume from the state file, skipping completed images
  --dry-run           Scan and plan the queue without calling the API
  --self-test         Run internal checks (no API) and exit
  -h, --help          Show this help

Examples:
  node tools/gemini-batch-metadata.mjs ./images --keys AIza...,AIza... --delay 1.8
  node tools/gemini-batch-metadata.mjs ./images --resume`;

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
  console.log("\n[stop] Saving progress... (Ctrl+C again to force quit)");
});

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isConnector(value) {
  const word = String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  return CONNECTOR_WORDS.has(word);
}

function fitTitle(raw) {
  let title = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (title.length <= MAX_TITLE_CHARS) return title;
  let cut = title.slice(0, MAX_TITLE_CHARS);
  const space = cut.lastIndexOf(" ");
  if (space > 0) cut = cut.slice(0, space);
  const words = cut.split(" ");
  while (words.length > 0 && isConnector(words[words.length - 1])) words.pop();
  return words.join(" ").trim();
}

function buildPool(title, tags) {
  const pool = [];
  const add = (part) => {
    const item = String(part ?? "").trim();
    if (item.length >= 3 && !isConnector(item) && item.length <= 80) pool.push(item);
  };
  for (const word of String(title ?? "").split(/\s+/)) add(word);
  for (const tag of tags) add(tag);
  for (const id of FALLBACK_IDENTIFIERS) add(id);
  return pool;
}

function normalizeTags(raw, count, title) {
  const parts = String(raw ?? "")
    .split(/[,;\n]/)
    .map((s) => s.trim().replace(/^["']+|["']+$/g, ""))
    .filter((s) => s.length >= 3 && s.length <= 80 && !isConnector(s));
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(part);
    if (out.length >= count) break;
  }
  const pool = buildPool(title, out);
  for (const item of pool) {
    if (out.length >= count) break;
    const lower = item.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(item);
  }
  return out.slice(0, count);
}

function csvField(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function toCsv(results) {
  const lines = ["Filename,Title,Keywords"];
  for (const result of results) {
    lines.push(
      `${csvField(result.name)},${csvField(result.title)},${csvField(result.tags.join(", "))}`
    );
  }
  return lines.join("\r\n");
}

class KeyManager {
  constructor(keys, delayMs) {
    this.keys = keys.map((key) => ({
      key,
      cooldownUntil: 0,
      lastUsedAt: 0,
      bad: false,
    }));
    this.delayMs = delayMs;
  }

  get length() {
    return this.keys.length;
  }

  next() {
    const now = Date.now();
    const usable = this.keys.filter((entry) => !entry.bad);
    if (usable.length === 0) return null;
    const ready = usable.filter((entry) => entry.cooldownUntil <= now);
    const pool = ready.length > 0 ? ready : usable;
    const chosen = pool.reduce((a, b) => (a.lastUsedAt <= b.lastUsedAt ? a : b));
    const waitMs = Math.max(
      0,
      chosen.lastUsedAt + this.delayMs - now,
      chosen.cooldownUntil - now
    );
    chosen.lastUsedAt = Math.max(now, chosen.lastUsedAt + this.delayMs);
    return { key: chosen.key, waitMs };
  }

  markRateLimited(key, untilMs) {
    const entry = this.keys.find((e) => e.key === key);
    if (entry) entry.cooldownUntil = Math.max(entry.cooldownUntil, untilMs);
  }

  markBad(key) {
    const entry = this.keys.find((e) => e.key === key);
    if (entry) {
      entry.bad = true;
      entry.cooldownUntil = Infinity;
    }
  }
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isNetworkError(error) {
  return (
    error instanceof TypeError ||
    error.name === "AbortError" ||
    /fetch failed|ECONN|ENOTFOUND|socket/i.test(String(error?.message ?? ""))
  );
}

async function generateOnce(image, apiKey, opts) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(opts.model)}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { inlineData: { mimeType: image.mime, data: image.base64 } },
          { text: PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  });
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    },
    opts.requestTimeoutMs
  );
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const error = new Error("Rate limited (HTTP 429)");
    error.code = 429;
    error.status = 429;
    error.retryAfterMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
    throw error;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(
      `Gemini API ${response.status}: ${text.slice(0, 200)}`
    );
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ??
    "";
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Gemini did not return a JSON object.");
  }
  return {
    title: String(parsed.title ?? ""),
    tags: String(parsed.tags ?? ""),
  };
}

async function requestWithKeys(image, keys, opts) {
  let lastError = null;
  for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
    const slot = keys.next();
    if (!slot) {
      throw new Error("All Gemini API keys are unavailable (rate-limited or invalid).");
    }
    if (slot.waitMs > 0) await sleep(slot.waitMs);
    try {
      return await generateOnce(image, slot.key, opts);
    } catch (error) {
      lastError = error;
      if (error.code === 429) {
        const until = Date.now() + (error.retryAfterMs ?? opts.retryAfterMs);
        keys.markRateLimited(slot.key, until);
        console.warn(
          `[429] Key ...${slot.key.slice(-4)} rate-limited; cooling down ${Math.round(
            (until - Date.now()) / 1000
          )}s and switching key.`
        );
        continue;
      }
      if (error.status === 403) {
        keys.markBad(slot.key);
        console.warn(`[403] Key ...${slot.key.slice(-4)} invalid/quota; removing from rotation.`);
        continue;
      }
      if (error.status >= 500 || isNetworkError(error)) {
        await sleep(opts.networkRetryMs);
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error("Request failed after retries.");
}

function readImage(filePath) {
  const size = statSync(filePath).size;
  if (size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image too large (${(size / (1024 * 1024)).toFixed(1)} MB, max ${MAX_IMAGE_BYTES / (1024 * 1024)} MB)`
    );
  }
  const base64 = readFileSync(filePath).toString("base64");
  return {
    base64,
    mime: MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "image/jpeg",
  };
}

function collectFiles(inputs) {
  const collected = [];
  const seen = new Set();
  const add = (filePath) => {
    const absolute = resolve(filePath);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    collected.push(absolute);
  };
  const walk = (target) => {
    const stat = statSync(target);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(target)) walk(join(target, entry));
    } else if (SUPPORTED_EXT.has(extname(target).toLowerCase())) {
      add(target);
    }
  };
  for (const input of inputs) {
    const absolute = resolve(input);
    if (existsSync(absolute)) walk(absolute);
    else console.warn(`[skip] Not found: ${input}`);
  }
  collected.sort();
  return collected;
}

function createState(files, opts) {
  return {
    version: 1,
    model: opts.model,
    keywordCount: opts.keywordCount,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    files: files.map((filePath) => ({
      path: filePath,
      name: basename(filePath),
      status: "pending",
      title: "",
      tags: [],
      error: "",
      attempts: 0,
    })),
  };
}

function loadState(stateFile) {
  if (!existsSync(stateFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(stateFile, "utf8"));
    if (parsed?.files && Array.isArray(parsed.files)) {
      for (const entry of parsed.files) {
        if (entry.status === "processing") entry.status = "pending";
      }
      return parsed;
    }
  } catch (error) {
    console.warn(`[warn] Could not read state file ${stateFile}: ${error.message}`);
  }
  return null;
}

function saveState(stateFile, state) {
  state.updatedAt = new Date().toISOString();
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

async function processFile(entry, opts, keys, state) {
  entry.status = "processing";
  entry.attempts += 1;
  saveState(opts.stateFile, state);
  try {
    const image = readImage(entry.path);
    const raw = await requestWithKeys(image, keys, opts);
    entry.title = fitTitle(raw.title);
    entry.tags = normalizeTags(raw.tags, opts.keywordCount, entry.title);
    entry.status = "done";
    entry.error = "";
  } catch (error) {
    entry.status = "failed";
    entry.error = String(error?.message ?? error);
  }
  saveState(opts.stateFile, state);
}

async function runQueue(state, opts, keys) {
  let processed = 0;
  for (let index = 0; index < state.files.length; index++) {
    if (stopping) {
      console.log("[stop] Queue stopped early.");
      break;
    }
    const entry = state.files[index];
    if (entry.status === "done") continue;
    if (entry.status === "failed") continue;
    console.log(`[${index + 1}/${state.files.length}] ${entry.name}`);
    await processFile(entry, opts, keys, state);
    processed++;
    if (entry.status === "done") {
      console.log(
        `  done  title(${entry.title.length}/70 chars)  tags(${entry.tags.length})`
      );
    } else {
      console.error(`  FAIL  ${entry.error}`);
    }
  }
  return processed;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    inputs: [],
    keys: [],
    model: DEFAULT_MODEL,
    delayMs: DEFAULT_DELAY_MS,
    keywordCount: DEFAULT_KEYWORD_COUNT,
    maxRetries: DEFAULT_RETRIES,
    out: "metadata-results.csv",
    jsonOut: "metadata-results.json",
    stateFile: ".batch-state.json",
    resume: false,
    dryRun: false,
    selfTest: false,
    help: false,
    retryAfterMs: 60_000,
    networkRetryMs: 2_000,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--keys":
        opts.keys = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--model":
        opts.model = args[++i] ?? opts.model;
        break;
      case "--delay":
        opts.delayMs = Math.max(0, parseFloat(args[++i] ?? "0") * 1000);
        break;
      case "--keywords":
        opts.keywordCount = clampInt(args[++i], 1, 49, DEFAULT_KEYWORD_COUNT);
        break;
      case "--max-retries":
        opts.maxRetries = clampInt(args[++i], 1, 10, DEFAULT_RETRIES);
        break;
      case "--out":
        opts.out = args[++i] ?? opts.out;
        break;
      case "--json":
        opts.jsonOut = args[++i] ?? opts.jsonOut;
        break;
      case "--state":
        opts.stateFile = args[++i] ?? opts.stateFile;
        break;
      case "--resume":
        opts.resume = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--self-test":
        opts.selfTest = true;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          opts.help = true;
        } else {
          opts.inputs.push(arg);
        }
    }
  }
  if (opts.keys.length === 0) {
    const envKeys = process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? "";
    opts.keys = envKeys.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return opts;
}

function runSelfTest() {
  const assert = (condition, message) => {
    if (!condition) {
      console.error("SELF-TEST FAIL: " + message);
      process.exitCode = 1;
    } else {
      console.log("ok - " + message);
    }
  };

  const longTitle =
    "A really long title that definitely exceeds seventy characters so we can " +
    "verify the word boundary truncation works correctly and cleanly";
  const fitted = fitTitle(longTitle);
  assert(fitted.length <= MAX_TITLE_CHARS, `fitTitle caps to 70 chars (got ${fitted.length})`);
  assert(fitted === fitted.trim(), "fitTitle has no leading/trailing space");

  const connector = fitTitle("word ".repeat(40) + "the");
  assert(
    connector.length <= MAX_TITLE_CHARS &&
      connector.split(" ").pop().toLowerCase() !== "the",
    "fitTitle trims trailing connector word"
  );

  const tags = normalizeTags(
    "Leaf, leaf, GREEN, a, an, pl, plant, isolated, vector, illustration,",
    DEFAULT_KEYWORD_COUNT,
    "Green leaf vector icon"
  );
  assert(tags.length === DEFAULT_KEYWORD_COUNT, `normalizeTags returns exactly 49 (got ${tags.length})`);
  assert(
    new Set(tags.map((tag) => tag.toLowerCase())).size === DEFAULT_KEYWORD_COUNT,
    "normalizeTags dedupes case-insensitively"
  );
  assert(!tags.some((tag) => tag.length < 3), "normalizeTags drops short tokens");

  const csv = toCsv([
    { name: 'a"b.jpg', title: 'He said "hi"', tags: ["one", "two"] },
  ]);
  assert(csv.includes('"a""b.jpg"'), "CSV escapes double quotes");
  assert(csv.includes('"one, two"'), "CSV quotes the keywords column");

  const manager = new KeyManager(["k1", "k2"], 100);
  const slotA = manager.next();
  const slotB = manager.next();
  assert(slotA.key === "k1" && slotB.key === "k2", "KeyManager rotates round-robin");
  manager.markRateLimited("k1", Date.now() + 5_000);
  const slotC = manager.next();
  assert(slotC.key === "k2", "KeyManager skips cooling-down key");
  manager.markBad("k2");
  const slotD = manager.next();
  assert(slotD.key === "k1" && slotD.waitMs > 0, "KeyManager falls back to earliest cooldown");
  manager.markBad("k1");
  assert(manager.next() === null, "KeyManager returns null when all keys are unusable");

  console.log("\nSELF-TEST PASSED");
}

async function main() {
  const opts = parseArgs();
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.selfTest) {
    runSelfTest();
    return;
  }

  const files = collectFiles(opts.inputs);
  if (files.length === 0) {
    console.error("No supported images found. Pass image files or folders as arguments.");
    process.exitCode = 1;
    return;
  }

  const existing = loadState(opts.stateFile);
  let state;
  if (opts.resume && existing) {
    state = existing;
    console.log(`[resume] ${state.files.length} entries loaded from ${opts.stateFile}`);
  } else {
    if (existing) {
      console.warn(
        `[warn] State file ${opts.stateFile} exists; starting a fresh queue (use --resume to continue).`
      );
    }
    state = createState(files, opts);
  }

  if (opts.dryRun) {
    const ready = state.files.filter((entry) => entry.status !== "done").length;
    const estimated =
      state.files.length * opts.delayMs;
    console.log(`[dry-run] images=${state.files.length} pending=${ready}`);
    console.log(`[dry-run] model=${opts.model} keywords=${opts.keywordCount} delay=${opts.delayMs / 1000}s`);
    console.log(
      `[dry-run] rough serial estimate: ${(estimated / 1000).toFixed(0)}s with 1 key`
    );
    for (const entry of state.files) {
      console.log(`  - ${entry.name} [${entry.status}]`);
    }
    return;
  }

  if (opts.keys.length === 0) {
    console.error(
      "No Gemini API keys provided. Use --keys k1,k2 or set GEMINI_API_KEYS / GEMINI_API_KEY."
    );
    process.exitCode = 1;
    return;
  }

  const keys = new KeyManager(opts.keys, opts.delayMs);
  console.log(
    `Starting ${opts.model} batch: ${state.files.length} images, ${keys.length} key(s), ` +
      `${opts.keywordCount} keywords, ${opts.delayMs / 1000}s per-key delay`
  );

  const startedAt = Date.now();
  await runQueue(state, opts, keys);
  const elapsedMs = Date.now() - startedAt;

  const done = state.files.filter((entry) => entry.status === "done");
  const failed = state.files.filter((entry) => entry.status === "failed");
  const pending = state.files.filter((entry) => entry.status === "pending");

  const results = done.map((entry) => ({
    file: entry.path,
    name: entry.name,
    title: entry.title,
    tags: entry.tags,
  }));

  if (results.length > 0) {
    writeFileSync(opts.jsonOut, JSON.stringify(results, null, 2));
    writeFileSync(opts.out, toCsv(results), "utf8");
  }
  saveState(opts.stateFile, state);

  console.log(`\nDone in ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`  done    ${done.length}`);
  console.log(`  failed  ${failed.length}`);
  console.log(`  pending ${pending.length} (rerun with --resume to continue)`);
  if (results.length > 0) {
    console.log(`  CSV  -> ${opts.out}`);
    console.log(`  JSON -> ${opts.jsonOut}`);
  }
  if (failed.length > 0) {
    for (const entry of failed) {
      console.error(`  FAIL  ${entry.name}: ${entry.error}`);
    }
  }
  process.exitCode = pending.length > 0 || failed.length > 0 ? 2 : 0;
}

await main();
