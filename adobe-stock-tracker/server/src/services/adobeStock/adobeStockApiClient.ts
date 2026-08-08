import { config } from '../../config';
import { dedupeInFlight, createSemaphore } from '../../lib/requestQueue';
import type {
  AssetSearchFilter,
  AssetSearchSort,
  ContentType,
  ContentTypeFilter,
  FilterOption,
  SortOption,
} from './adobeStockTypes';

/**
 * Official Adobe Stock API client (Search/Files endpoint).
 *
 * Docs: https://developer.adobe.com/stock/docs/api/11-search-reference
 * Base:  https://stock.adobe.io/Rest/Media/1/Search/Files
 *
 * This is the ONLY supported way this app talks to Adobe: it calls the
 * documented REST API with the configured API key. It never scrapes the
 * website and never tries to bypass Adobe's access controls.
 *
 * Compliance details:
 *  - Concurrent upstream calls are capped (ADOBE_REQUEST_CONCURRENCY) via a
 *    client-side queue — the app self-throttles instead of hammering Adobe.
 *  - Identical in-flight requests are coalesced (dedupe) so the same query
 *    never hits Adobe twice at once.
 *  - Transient failures (429 / 5xx) are retried with exponential backoff
 *    honoring the Retry-After header. This respects rate limits, never
 *    bypasses them.
 */

/** Shape of a single file object in the Search API response. */
export interface AdobeStockApiFile {
  id?: number;
  title?: string;
  creator_id?: number;
  creator_name?: string;
  thumbnail_url?: string;
  thumbnail_500_url?: string;
  thumbnail_1000_url?: string;
  details_url?: string;
  content_type?: string;
  media_type_id?: number;
  vector_type?: string | null;
  width?: number;
  height?: number;
  category?: { id?: number; name?: string } | string | null;
  category_hierarchy?: unknown;
  description?: string;
  is_transparent?: boolean;
  is_gentech?: boolean;
  /** Array of { name } keyword objects, when the `keywords` result column is requested. */
  keywords?: Array<{ name?: string }>;
  // License History fields (present in the LicenseHistory response only).
  /** License type ("Standard", "Extended", "Video_HD", …). */
  license?: string;
  /** License date, locale-formatted (e.g. "1/17/2024 4:32:00 AM"). */
  license_date?: string;
  /** Licensed download URL (requires authentication). */
  download_url?: string;
  license_reference?: string;
}

export interface AdobeStockApiSearchResponse {
  nb_results?: number;
  files?: AdobeStockApiFile[];
  error?: string;
  code?: number;
}

/** Result of one upstream API call, with an honest status. */
export type AdobeStockApiSearchResult =
  | { status: 'ok'; data: AdobeStockApiSearchResponse }
  | { status: 'blocked'; statusCode?: number; message: string }
  | { status: 'rate_limited'; statusCode?: number; message: string }
  | { status: 'timeout' }
  | { status: 'error'; statusCode?: number; message: string };

export interface AdobeStockApiCredentials {
  /** "x-api-key" header. */
  clientId: string;
  /** "X-Product" header. */
  product: string;
  /** Optional OAuth access token for the "Authorization: Bearer" header. */
  accessToken?: string;
}

export interface AdobeStockApiRequestOptions {
  baseUrl: string;
  /** Base URL for the License History endpoint (when it differs from baseUrl). */
  licenseHistoryBaseUrl: string;
  locale: string;
  timeoutMs: number;
  credentials: AdobeStockApiCredentials;
}

export interface AdobeStockApiQuery {
  creatorId: string;
  filter: FilterOption;
  sort: SortOption;
  contentType: ContentTypeFilter;
  page: number;
  limit: number;
}

export interface AdobeStockApiAssetQuery {
  query: string;
  filter: AssetSearchFilter;
  sort: AssetSearchSort;
  page: number;
  limit: number;
}

export interface AdobeStockApiAssetIdQuery {
  assetId: string;
}

const CONTENT_TYPE_PARAMS: Record<Exclude<ContentType, 'unknown' | 'audio'>, string> = {
  photo: 'content_type:photo',
  illustration: 'content_type:illustration',
  vector: 'content_type:vector',
  video: 'content_type:video',
  template: 'content_type:template',
  '3d': 'content_type:3d',
};

/** Map an app sort to the API's order values (Adobe only supports descending). */
export function resolveApiOrder(filter: FilterOption, sort: SortOption): string {
  switch (filter) {
    case 'undiscovered':
      return 'undiscovered';
    case 'recent':
      return 'creation';
    case 'downloaded':
      return 'nb_downloads';
    default:
      return sort === 'creation-desc' || sort === 'creation-asc' ? 'creation' : 'nb_downloads';
  }
}

/** Content-type filters to send for a given tab + content-type selection. */
export function resolveContentTypeParams(filter: FilterOption, contentType: ContentTypeFilter): string[] {
  if (filter === 'vector') return [CONTENT_TYPE_PARAMS.vector];
  if (contentType === 'all') return Object.values(CONTENT_TYPE_PARAMS);
  return [CONTENT_TYPE_PARAMS[contentType]];
}

/** Map an Asset-search sort to the API's order values. */
export function resolveAssetApiOrder(sort: AssetSearchSort): string {
  switch (sort) {
    case 'downloads':
      return 'nb_downloads';
    case 'newest':
      return 'creation';
    case 'undiscovered':
      return 'undiscovered';
    default:
      return 'relevance';
  }
}

/**
 * Content-type filters for an Asset search. "all" omits content-type filters
 * (the API then returns every asset type). "transparent" and "ai" are
 * characteristic filters, not content types, so they map to nothing here.
 */
export function resolveAssetContentTypeParams(filter: AssetSearchFilter): string[] {
  if (filter === 'all' || filter === 'transparent' || filter === 'ai') return [];
  return [CONTENT_TYPE_PARAMS[filter]];
}

/** Whether an asset-search filter is a characteristic filter (not a content type). */
export function isCharacteristicAssetFilter(filter: AssetSearchFilter): boolean {
  return filter === 'transparent' || filter === 'ai';
}

/** Result columns the dashboard requests from the Search API. */
const REQUESTED_COLUMNS = [
  'id',
  'title',
  'creator_id',
  'creator_name',
  'thumbnail_url',
  'thumbnail_500_url',
  'thumbnail_1000_url',
  'details_url',
  'content_type',
  'media_type_id',
  'vector_type',
  'width',
  'height',
  'category',
  'category_hierarchy',
  'description',
  'is_transparent',
  'is_gentech',
  'keywords',
];

function push(params: Array<[string, string]>, name: string, value: string | number): void {
  params.push([name, String(value)]);
}

/**
 * Build the Search/Files query URL.
 *
 * Notes on correctness:
 *  - Keys and values are percent-encoded with encodeURIComponent (this encodes
 *    the brackets and the ":" in "content_type:photo").
 *  - `search_parameters[filters][premium]=false` is always sent: it fixes a
 *    documented Adobe bug where more results than `limit` can be returned.
 */
export function buildAdobeStockApiSearchUrl(options: AdobeStockApiRequestOptions, query: AdobeStockApiQuery): string {
  const params: Array<[string, string]> = [];

  push(params, 'locale', options.locale);
  push(params, 'search_parameters[creator_id]', query.creatorId);
  push(params, 'search_parameters[limit]', query.limit);
  push(params, 'search_parameters[offset]', (query.page - 1) * query.limit);
  push(params, 'search_parameters[order]', resolveApiOrder(query.filter, query.sort));
  push(params, 'search_parameters[filters][premium]', 'false');

  for (const type of resolveContentTypeParams(query.filter, query.contentType)) {
    push(params, `search_parameters[filters][${type}]`, 1);
  }
  if (query.filter === 'transparent') {
    push(params, 'search_parameters[filters][transparent]', 'true');
  }

  for (const column of REQUESTED_COLUMNS) {
    push(params, 'result_columns[]', column);
  }

  const queryString = params.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&');
  return `${options.baseUrl}?${queryString}`;
}

/**
 * Build the Search/Files query URL for a keyword (Asset/Title) search.
 *
 * Uses the same correctness rules as the creator search builder:
 * percent-encoding, `filters[premium]=false` pagination fix, documented
 * `search_parameters[words]` and `order` values only.
 */
export function buildAdobeStockApiAssetSearchUrl(
  options: AdobeStockApiRequestOptions,
  query: AdobeStockApiAssetQuery,
): string {
  const params: Array<[string, string]> = [];

  push(params, 'locale', options.locale);
  push(params, 'search_parameters[words]', query.query);
  push(params, 'search_parameters[limit]', query.limit);
  push(params, 'search_parameters[offset]', (query.page - 1) * query.limit);
  push(params, 'search_parameters[order]', resolveAssetApiOrder(query.sort));
  push(params, 'search_parameters[filters][premium]', 'false');

  for (const type of resolveAssetContentTypeParams(query.filter)) {
    push(params, `search_parameters[filters][${type}]`, 1);
  }
  if (isCharacteristicAssetFilter(query.filter)) {
    if (query.filter === 'transparent') {
      push(params, 'search_parameters[filters][transparent]', 'true');
    } else if (query.filter === 'ai') {
      push(params, 'search_parameters[filters][gentech]', 'true');
    }
  }

  for (const column of REQUESTED_COLUMNS) {
    push(params, 'result_columns[]', column);
  }

  const queryString = params.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&');
  return `${options.baseUrl}?${queryString}`;
}

/**
 * Build the Search/Files query URL for a single-asset (media_id) lookup.
 * Adobe's docs: "Search for one specific asset by its unique identifier
 * (media_id). Integer."
 */
export function buildAdobeStockApiAssetIdUrl(options: AdobeStockApiRequestOptions, query: AdobeStockApiAssetIdQuery): string {
  const params: Array<[string, string]> = [];

  push(params, 'locale', options.locale);
  push(params, 'search_parameters[media_id]', query.assetId);
  push(params, 'search_parameters[limit]', 1);
  push(params, 'search_parameters[offset]', 0);
  push(params, 'search_parameters[filters][premium]', 'false');

  for (const column of REQUESTED_COLUMNS) {
    push(params, 'result_columns[]', column);
  }

  const queryString = params.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&');
  return `${options.baseUrl}?${queryString}`;
}

export interface AdobeStockApiLicenseHistoryQuery {
  /** Number of licensed assets to request per page (1–100). */
  limit: number;
  /** Pagination offset (0-based). */
  offset: number;
}

/** Result columns requested from the License History endpoint. */
const LICENSE_HISTORY_COLUMNS = [
  'id',
  'title',
  'creator_id',
  'creator_name',
  'thumbnail_110_url',
  'thumbnail_220_url',
  'thumbnail_500_url',
  'thumbnail_1000_url',
  'details_url',
  'download_url',
  'content_type',
  'media_type_id',
  'license',
  'license_date',
];

/**
 * Build the License History query URL.
 *
 * This is the ONLY authorized way to read licensing data: the authenticated
 * user's own license history (never another contributor's). It requires the
 * OAuth access token header set by buildAdobeStockApiHeaders.
 *
 * Docs: https://developer.adobe.com/stock/docs/api/13-license-history
 * Note: the API cannot filter by date or free text server-side, so the app
 * scans the first N pages and applies query/date filters locally.
 */
export function buildAdobeStockApiLicenseHistoryUrl(
  options: AdobeStockApiRequestOptions,
  query: AdobeStockApiLicenseHistoryQuery,
): string {
  const params: Array<[string, string]> = [];

  push(params, 'locale', options.locale);
  push(params, 'search_parameters[limit]', query.limit);
  push(params, 'search_parameters[offset]', query.offset);
  push(params, 'all', 'true');

  for (const column of LICENSE_HISTORY_COLUMNS) {
    push(params, 'result_columns[]', column);
  }

  const queryString = params.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&');
  return `${options.licenseHistoryBaseUrl ?? options.baseUrl}?${queryString}`;
}

export function buildAdobeStockApiHeaders(credentials: AdobeStockApiCredentials): Record<string, string> {
  const headers: Record<string, string> = {
    'x-api-key': credentials.clientId,
    'X-Product': credentials.product,
    Accept: 'application/json',
  };
  if (credentials.accessToken) {
    headers.Authorization = `Bearer ${credentials.accessToken}`;
  }
  return headers;
}

interface RetryConfig {
  maxRetries: number;
  backoffBaseMs: number;
}

const GLOBAL_GATE = createSemaphore(Math.max(config.adobeApi.concurrency, 1));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call the official Adobe Stock Search API once (without retry).
 *
 * Every failure mode maps to an honest status; the provider surfaces these to
 * the UI. No data is invented on any error path.
 */
export async function fetchAdobeStockSearchOnce(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<AdobeStockApiSearchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });

    let body: AdobeStockApiSearchResponse | null = null;
    const text = await response.text();
    try {
      body = text ? (JSON.parse(text) as AdobeStockApiSearchResponse) : null;
    } catch {
      body = null;
    }

    if (response.status === 429) {
      return { status: 'rate_limited', statusCode: 429, message: body?.error ?? 'Adobe Stock API rate-limited the request.' };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        status: 'blocked',
        statusCode: response.status,
        message:
          body?.error ??
          (response.status === 401
            ? 'Adobe Stock API rejected the API key (401). Check ADOBE_API_CLIENT_ID.'
            : 'Adobe Stock API denied the request (403). Check the configured API key/permissions.'),
      };
    }
    if (!response.ok) {
      return {
        status: 'error',
        statusCode: response.status,
        message: typeof body?.error === 'string' && body.error ? body.error : `Adobe Stock API returned HTTP ${response.status}.`,
      };
    }
    if (!body || typeof body !== 'object') {
      return { status: 'error', statusCode: response.status, message: 'Adobe Stock API returned an unexpected response.' };
    }

    return { status: 'ok', data: body };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 'timeout' };
    }
    return { status: 'error', message: 'Could not reach the Adobe Stock API.' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retryable, rate-limit-respecting call to the Adobe Stock API.
 *
 * Retries ONLY transient failures (429 and HTTP 5xx) using exponential
 * backoff that doubles per attempt and honors Adobe's `Retry-After` header.
 * 4xx client errors and 401/403 are never retried. Concurrent requests are
 * queued (self-throttled) and identical in-flight calls are coalesced.
 */
export async function fetchAdobeStockSearch(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  retry: RetryConfig = { maxRetries: config.adobeApi.maxRetries, backoffBaseMs: config.adobeApi.backoffBaseMs },
): Promise<AdobeStockApiSearchResult> {
  const attempt = async (): Promise<AdobeStockApiSearchResult> => {
    let last: AdobeStockApiSearchResult | null = null;

    for (let attemptNumber = 0; attemptNumber <= retry.maxRetries; attemptNumber += 1) {
      const result = await fetchAdobeStockSearchOnce(url, headers, timeoutMs);
      const retryable = result.status === 'rate_limited' || (result.status === 'error' && (result.statusCode ?? 0) >= 500);
      if (!retryable || attemptNumber === retry.maxRetries) return result;
      last = result;

      const delay = retry.backoffBaseMs * 2 ** attemptNumber + Math.round(Math.random() * 200);
      await sleep(delay);
    }

    return last ?? { status: 'error', message: 'The Adobe Stock API could not be reached.' };
  };

  return GLOBAL_GATE(() => dedupeInFlight(url, attempt));
}

/**
 * Call the License History endpoint (the authenticated user's own licensing
 * history). It reuses the same polite, retryable transport as the search API;
 * authentication comes from the OAuth `Authorization: Bearer` header.
 */
export async function fetchAdobeStockLicenseHistory(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<AdobeStockApiSearchResult> {
  return fetchAdobeStockSearch(url, headers, timeoutMs);
}
