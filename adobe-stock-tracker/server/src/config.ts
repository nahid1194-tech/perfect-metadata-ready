import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment from server/.env first, then from the project root .env.
// Every value has a safe default, so the app runs without a .env file.
for (const candidate of [path.resolve(__dirname, '../.env'), path.resolve(__dirname, '../../.env')]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
  }
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Official Adobe Stock API configuration.
 *
 * Only an Adobe API key (ADOBE_STOCK_API_KEY or the alias
 * ADOBE_API_CLIENT_ID, sent as the "x-api-key" header) is required to start
 * fetching public asset data. When it is not set, the API provider returns a
 * clear "setup required" message instead of inventing data.
 *
 * License History additionally requires an OAuth access token
 * (ADOBE_STOCK_ACCESS_TOKEN / ADOBE_API_ACCESS_TOKEN, sent as
 * "Authorization: Bearer") because it represents the authenticated user's own
 * licensing history and nothing else.
 *
 * The Authorization header is optional: it is only needed to see license
 * state, which this dashboard does not use.
 */
export const config = {
  port: int('PORT', 4000),
  adobeApi: {
    baseUrl: process.env.ADOBE_API_BASE_URL ?? 'https://stock.adobe.io/Rest/Media/1/Search/Files',
    clientId: process.env.ADOBE_STOCK_API_KEY ?? process.env.ADOBE_API_CLIENT_ID ?? '',
    product: process.env.ADOBE_STOCK_PRODUCT ?? process.env.ADOBE_API_PRODUCT ?? 'AdobeStockTracker/1.0',
    accessToken: process.env.ADOBE_STOCK_ACCESS_TOKEN ?? process.env.ADOBE_API_ACCESS_TOKEN ?? '',
    locale: process.env.ADOBE_API_LOCALE ?? 'en_US',
    requestTimeoutMs: int('ADOBE_API_TIMEOUT_MS', 15000),
    limit: int('ADOBE_API_LIMIT', 100),
    maxPages: int('ADOBE_API_MAX_PAGES', 5),
    // License History endpoint (requires OAuth) and how many upstream pages
    // the app is willing to scan so filtering/search stays bounded and polite.
    licenseHistoryBaseUrl:
      process.env.ADOBE_LICENSE_HISTORY_BASE_URL ?? 'https://stock.adobe.io/Rest/Libraries/1/Member/LicenseHistory',
    licenseHistoryMaxPages: int('ADOBE_LICENSE_HISTORY_MAX_PAGES', 10),
    // Max concurrent upstream Adobe requests (a polite client-side queue).
    concurrency: int('ADOBE_REQUEST_CONCURRENCY', 2),
    // Retries for transient upstream failures (429/5xx) using exponential backoff.
    maxRetries: int('ADOBE_MAX_RETRIES', 2),
    // Base delay (ms) for the first retry; doubles per attempt.
    backoffBaseMs: int('ADOBE_BACKOFF_BASE_MS', 1000),
  },
  adobeSite: {
    // Public Adobe Stock search page. Links are only *generated* against this
    // URL (opened in the user's browser); the backend never fetches it.
    searchBaseUrl: process.env.ADOBE_SEARCH_BASE_URL ?? 'https://stock.adobe.com/search',
    limit: int('ADOBE_SEARCH_LIMIT', 100),
  },
  database: {
    // PostgreSQL connection string. When empty, the app runs DB-less and
    // historical observations fall back to a session-only in-memory store.
    url: process.env.DATABASE_URL ?? '',
    enabled: Boolean(process.env.DATABASE_URL),
  },
  scheduler: {
    // Whether the background observation job runs at all.
    enabled: process.env.OBSERVATION_SCHEDULER_ENABLED !== 'false',
    // Delay before the first run after boot (lets the server come up first).
    startDelayMs: int('OBSERVATION_START_DELAY_MS', 5000),
    // How often the background observation job re-samples tracked creators.
    intervalMs: int('OBSERVATION_INTERVAL_MS', 6 * 60 * 60 * 1000),
    // Max assets per creator sampled by each job run.
    perCreatorLimit: int('OBSERVATION_PER_CREATOR_LIMIT', 100),
  },
  cache: {
    ttlMs: int('CACHE_TTL_MS', 5 * 60 * 1000),
  },
  rateLimit: {
    windowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
    max: int('RATE_LIMIT_MAX_REQUESTS', 30),
  },
  dataProvider: process.env.ADOBE_DATA_PROVIDER ?? '',
};
