import { config } from '../../config';
import {
  buildAssetIdSearchLink as buildSiteAssetIdLink,
  buildAssetSearchLinks as buildSiteAssetSearchLinks,
  buildCreatorSearchLinks,
} from './adobeStockSearchUrlBuilder';
import {
  buildAdobeStockApiAssetIdUrl,
  buildAdobeStockApiAssetSearchUrl,
  buildAdobeStockApiHeaders,
  buildAdobeStockApiLicenseHistoryUrl,
  buildAdobeStockApiSearchUrl,
  buildAdobeStockApiSimilarUrl,
  fetchAdobeStockLicenseHistory,
  fetchAdobeStockSearch,
  resolveApiOrder,
  resolveAssetApiOrder,
  type AdobeStockApiFile,
  type AdobeStockApiRequestOptions,
  type AdobeStockApiSearchResult,
} from './adobeStockApiClient';
import type {
  AdobeStockAsset,
  AdobeStockProviderCapabilities,
  AssetMetadataResult,
  AssetSearchLinks,
  AssetSearchParams,
  AssetSearchResult,
  ContentType,
  CreatorAssetsResult,
  CreatorAvailability,
  CreatorSearchLinks,
  FetchCreatorAssetsParams,
  LicenseHistoryEntry,
  LicenseHistoryParams,
  LicenseHistoryResult,
  SourceStatus,
} from './adobeStockTypes';

const SETUP_MESSAGE =
  'Adobe Stock API credentials are not configured, so no data can be shown. ' +
  'Create a free Adobe Stock API key at developer.adobe.com, then set ADOBE_STOCK_API_KEY ' +
  '(and optionally ADOBE_STOCK_PRODUCT) in server/.env — see README.md. ' +
  'Nothing is displayed until credentials are present; no data is ever fabricated.';

const LICENSE_HISTORY_UNAUTHORIZED_MESSAGE =
  'License History requires an authorized Adobe account. Set ADOBE_STOCK_ACCESS_TOKEN ' +
  '(an OAuth access token for the authenticated user) in server/.env — see README.md. ' +
  'This section shows only that user\u2019s own license history, never another contributor\u2019s.';

const API_NOTICE =
  'Official Adobe Stock API. Assets are ranked by Adobe (relevance / most downloaded / newest / undiscovered). ' +
  'Adobe\u2019s API does not expose per-asset download counts or upload dates, so those values show as unavailable. ' +
  'When ordered by popularity, a clearly-labeled "popularity signal" (derived from Adobe\u2019s ranking) is shown instead ' +
  'of an invented count.';

/**
 * Provider backed by the official Adobe Stock API.
 *
 * This is the intended production provider. It only ever calls the documented
 * REST API; it never scrapes the website and never bypasses Adobe's controls.
 *
 * When ADOBE_API_CLIENT_ID is not configured it reports `source: "unavailable"`
 * with setup instructions — an honest empty state, never invented numbers.
 */
export class AdobeStockApiProvider {
  readonly name = 'adobe-stock-api';
  readonly mode = 'api' as const;

  readonly capabilities: AdobeStockProviderCapabilities = {
    canPartitionDiscovered: false,
    exposesDownloadCounts: false,
  };

  buildCreatorSearchLinks(creatorId: string): CreatorSearchLinks {
    return buildCreatorSearchLinks({
      baseUrl: config.adobeSite.searchBaseUrl,
      creatorId,
      limit: config.adobeSite.limit,
    });
  }

  buildAssetSearchLinks(query: string): AssetSearchLinks {
    return buildSiteAssetSearchLinks({
      baseUrl: config.adobeSite.searchBaseUrl,
      query,
      limit: config.adobeSite.limit,
    });
  }

  buildAssetIdSearchLink(assetId: string): string {
    return buildSiteAssetIdLink(config.adobeSite.searchBaseUrl, assetId, config.adobeSite.limit);
  }

  private requestOptions(): AdobeStockApiRequestOptions {
    return {
      baseUrl: config.adobeApi.baseUrl,
      licenseHistoryBaseUrl: config.adobeApi.licenseHistoryBaseUrl,
      locale: config.adobeApi.locale,
      timeoutMs: config.adobeApi.requestTimeoutMs,
      credentials: {
        clientId: config.adobeApi.clientId,
        product: config.adobeApi.product,
        accessToken: config.adobeApi.accessToken,
      },
    };
  }

  getCreatorAvailability(): CreatorAvailability {
    return buildCreatorAvailability({
      officialApiAvailable: Boolean(config.adobeApi.clientId),
      exposesDownloadCounts: Boolean(this.capabilities.exposesDownloadCounts),
      providerName: this.name,
    });
  }

  async getLicenseHistory(params: LicenseHistoryParams): Promise<LicenseHistoryResult> {
    if (!config.adobeApi.clientId) {
      return licenseHistoryUnauthorized('unavailable', SETUP_MESSAGE, this.name);
    }
    if (!config.adobeApi.accessToken) {
      return licenseHistoryUnauthorized('unavailable', LICENSE_HISTORY_UNAUTHORIZED_MESSAGE, this.name);
    }

    const options = this.requestOptions();
    const headers = buildAdobeStockApiHeaders(options.credentials);

    const pageSize = Math.min(Math.max(params.limit, 1), 100);
    const entries: LicenseHistoryEntry[] = [];
    let total: number | null = null;
    let lastFailure: AdobeStockApiSearchResult | null = null;
    let scanned = 0;

    for (let page = 0; page < config.adobeApi.licenseHistoryMaxPages; page += 1) {
      const url = buildAdobeStockApiLicenseHistoryUrl(options, { limit: pageSize, offset: page * pageSize });
      const fetched = await fetchAdobeStockLicenseHistory(url, headers, options.timeoutMs);

      if (fetched.status !== 'ok') {
        lastFailure = fetched;
        break;
      }

      if (page === 0 && typeof fetched.data.nb_results === 'number') {
        total = fetched.data.nb_results;
      }
      const files = fetched.data.files ?? [];
      scanned += files.length;
      for (const file of files) {
        entries.push(mapLicenseFileToEntry(file));
      }
      if (files.length < pageSize) break;
    }

    if (lastFailure && entries.length === 0) {
      if (lastFailure.status === 'blocked') {
        return licenseHistoryUnauthorized('blocked', lastFailure.message, this.name);
      }
      return licenseHistoryFromFailure(lastFailure, this.name);
    }

    const filtered = applyLicenseHistoryFilters(entries, params);
    const totalFiltered = filtered.length;
    const hasMore = params.page * params.limit < totalFiltered;
    const slice = filtered.slice((params.page - 1) * params.limit, params.page * params.limit);

    const truncated = total !== null && scanned < total;
    const notice = truncated
      ? `License History scanned the first ${scanned} of ${total} licensed assets (cap: ${config.adobeApi.licenseHistoryMaxPages} pages). Refine the search to see older entries.`
      : `Source: Adobe Stock License History API. This is the authenticated account\u2019s own license history, not another contributor\u2019s download history.`;

    return {
      entries: slice,
      total: totalFiltered,
      scanned,
      truncated,
      page: params.page,
      pageSize: params.limit,
      hasMore,
      authorized: true,
      source: slice.length === 0 ? 'empty' : 'ok',
      notice,
      provider: this.name,
    };
  }

  async fetchCreatorAssets(params: FetchCreatorAssetsParams): Promise<CreatorAssetsResult> {
    if (!config.adobeApi.clientId) {
      return creatorEmpty(params, 'unavailable', SETUP_MESSAGE, this.name);
    }

    const options = this.requestOptions();
    const url = buildAdobeStockApiSearchUrl(options, params);
    const headers = buildAdobeStockApiHeaders(options.credentials);
    const fetched = await fetchAdobeStockSearch(url, headers, options.timeoutMs);

    if (fetched.status !== 'ok') {
      return creatorFromApiFailure(params, fetched);
    }

    const order = resolveApiOrder(params.filter, params.sort);
    const files = fetched.data.files ?? [];
    let assets = files.map((file) => mapFileToAsset(file, params.creatorId));
    if (isPopularityOrder(order)) {
      assets = withPopularity(assets, fetched.data.nb_results ?? files.length);
    }
    const total = typeof fetched.data.nb_results === 'number' ? fetched.data.nb_results : null;
    const hasMore = total !== null ? params.page * params.limit < total : assets.length >= params.limit;

    return {
      creatorId: params.creatorId,
      assets,
      total,
      page: params.page,
      pageSize: params.limit,
      hasMore,
      source: assets.length === 0 ? 'empty' : 'ok',
      notice: API_NOTICE,
      provider: this.name,
    };
  }

  async searchAssets(params: AssetSearchParams): Promise<AssetSearchResult> {
    if (!config.adobeApi.clientId) {
      return assetSearchEmpty(params, 'unavailable', SETUP_MESSAGE, this.name);
    }

    const options = this.requestOptions();
    const url = buildAdobeStockApiAssetSearchUrl(options, params);
    const headers = buildAdobeStockApiHeaders(options.credentials);
    const fetched = await fetchAdobeStockSearch(url, headers, options.timeoutMs);

    if (fetched.status !== 'ok') {
      return assetSearchFromApiFailure(params, fetched);
    }

    const files = fetched.data.files ?? [];
    let assets = files.map((file) => mapFileToAsset(file, ''));
    if (isPopularityOrder(resolveAssetApiOrder(params.sort))) {
      assets = withPopularity(assets, fetched.data.nb_results ?? files.length);
    }
    const total = typeof fetched.data.nb_results === 'number' ? fetched.data.nb_results : null;
    const hasMore = total !== null ? params.page * params.limit < total : assets.length >= params.limit;

    return {
      query: params.query,
      assets,
      total,
      page: params.page,
      pageSize: params.limit,
      hasMore,
      source: assets.length === 0 ? 'empty' : 'ok',
      notice: API_NOTICE,
      provider: this.name,
    };
  }

  async searchByAssetId(assetId: string): Promise<AssetMetadataResult> {
    return this.getAssetMetadata(assetId);
  }

  /**
   * Search for assets visually similar to a given asset ID using Adobe's
   * documented `search_parameters[similar]` parameter. Mirrors searchAssets
   * in result shape and error handling.
   */
  async searchSimilar(assetId: string, params: AssetSearchParams): Promise<AssetSearchResult> {
    if (!config.adobeApi.clientId) {
      return assetSearchEmpty(params, 'unavailable', SETUP_MESSAGE, this.name);
    }

    const options = this.requestOptions();
    const url = buildAdobeStockApiSimilarUrl(options, { assetId, ...params });
    const headers = buildAdobeStockApiHeaders(options.credentials);
    const fetched = await fetchAdobeStockSearch(url, headers, options.timeoutMs);

    if (fetched.status !== 'ok') {
      return assetSearchFromApiFailure(params, fetched);
    }

    const files = fetched.data.files ?? [];
    let assets = files.map((file) => mapFileToAsset(file, ''));
    if (isPopularityOrder(resolveAssetApiOrder(params.sort))) {
      assets = withPopularity(assets, fetched.data.nb_results ?? files.length);
    }
    const total = typeof fetched.data.nb_results === 'number' ? fetched.data.nb_results : null;
    const hasMore = total !== null ? params.page * params.limit < total : assets.length >= params.limit;

    return {
      query: String(assetId),
      assets,
      total,
      page: params.page,
      pageSize: params.limit,
      hasMore,
      source: assets.length === 0 ? 'empty' : 'ok',
      notice: API_NOTICE,
      provider: this.name,
    };
  }

  async getAssetMetadata(assetId: string): Promise<AssetMetadataResult> {
    if (!config.adobeApi.clientId) {
      return {
        asset: null,
        link: buildSiteAssetIdLink(config.adobeSite.searchBaseUrl, assetId, config.adobeSite.limit),
        source: 'unavailable',
        sourceMessage: SETUP_MESSAGE,
        provider: this.name,
      };
    }

    const options = this.requestOptions();
    const url = buildAdobeStockApiAssetIdUrl(options, { assetId });
    const headers = buildAdobeStockApiHeaders(options.credentials);
    const fetched = await fetchAdobeStockSearch(url, headers, options.timeoutMs);

    if (fetched.status !== 'ok') {
      return {
        asset: null,
        link: null,
        ...metadataFromApiFailure(fetched),
        provider: this.name,
      };
    }

    const files = fetched.data.files ?? [];
    const file = files[0];
    const asset = file ? mapFileToAsset(file, '') : null;
    if (asset && file && String(file.id) !== assetId) {
      return { asset: null, link: null, source: 'empty', notice: `No asset found for ID ${assetId}.`, provider: this.name };
    }

    return {
      asset,
      link: asset?.assetUrl ?? buildSiteAssetIdLink(config.adobeSite.searchBaseUrl, assetId, config.adobeSite.limit),
      source: asset ? 'ok' : 'empty',
      notice: asset ? API_NOTICE : `No asset found for ID ${assetId}.`,
      provider: this.name,
    };
  }
}

function isPopularityOrder(order: string): boolean {
  return order === 'nb_downloads' || order === 'undiscovered';
}

/** Add a clearly-labeled popularity signal from Adobe's own ranking order. */
function withPopularity(assets: AdobeStockAsset[], total: number): AdobeStockAsset[] {
  const n = Math.max(total, assets.length);
  return assets.map((asset, index) => ({
    ...asset,
    popularity: {
      rank: index + 1,
      total: n,
      percentile: n > 1 ? Math.round((1 - index / (n - 1)) * 1000) / 10 : 100,
    },
  }));
}

function mapFileToAsset(file: AdobeStockApiFile, creatorId: string): AdobeStockAsset {
  const thumbnail1000 = file.thumbnail_1000_url ?? null;
  const thumbnail500 = file.thumbnail_500_url ?? null;
  const thumbnailUrl = file.thumbnail_url ?? null;
  return {
    id: file.id !== undefined ? String(file.id) : '',
    title: file.title ?? null,
    // Priority: thumbnail_1000_url → thumbnail_500_url → thumbnail_url
    // (largest available preview first). Only Adobe's own URLs are used;
    // nothing is constructed manually.
    thumbnail: thumbnail1000 ?? thumbnail500 ?? thumbnailUrl,
    thumbnail500,
    thumbnailUrl,
    thumbnail1000,
    thumbnailWidth: typeof file.thumbnail_width === 'number' ? file.thumbnail_width : null,
    thumbnailHeight: typeof file.thumbnail_height === 'number' ? file.thumbnail_height : null,
    thumbnail1000Width: typeof file.thumbnail_1000_width === 'number' ? file.thumbnail_1000_width : null,
    thumbnail1000Height: typeof file.thumbnail_1000_height === 'number' ? file.thumbnail_1000_height : null,
    thumbnail110Url: file.thumbnail_110_url ?? null,
    thumbnail160Url: file.thumbnail_160_url ?? null,
    thumbnail240Url: file.thumbnail_240_url ?? null,
    hasReleases: typeof file.has_releases === 'boolean' ? file.has_releases : null,
    compUrl: file.comp_url ?? null,
    isLicensed: typeof file.is_licensed === 'boolean' ? file.is_licensed : null,
    framerate: typeof file.framerate === 'number' ? file.framerate : null,
    duration: typeof file.duration === 'number' ? file.duration : null,
    sizeBytes: typeof file.size_bytes === 'number' ? file.size_bytes : null,
    premiumLevelId: typeof file.premium_level_id === 'number' ? file.premium_level_id : null,
    isLoop: typeof file.is_loop === 'boolean' ? file.is_loop : null,
    videoPreviewUrl: file.video_preview_url ?? null,
    videoSmallPreviewUrl: file.video_small_preview_url ?? null,
    marketingText: file.marketing_text ?? null,
    countryName: file.country_name ?? null,
    iconOption: file.icon_option === undefined ? null : file.icon_option,
    templateTypeId: typeof file.template_type_id === 'number' ? file.template_type_id : null,
    templateCategoryIds: Array.isArray(file.template_category_ids)
      ? file.template_category_ids
          .map((t) => (typeof t?.name === 'string' ? t.name : ''))
          .filter((name) => name.length > 0)
      : null,
    assetUrl: file.details_url ?? null,
    creatorId,
    creatorName: file.creator_name ?? null,
    keywords:
      Array.isArray(file.keywords)
        ? file.keywords.map((k) => (typeof k?.name === 'string' ? k.name : '')).filter((name) => name.length > 0)
        : null,
    contentType: mapContentType(file),
    vectorType: file.vector_type ?? null,
    isPremium: typeof file.is_premium === 'boolean' ? file.is_premium : null,
    downloads: null,
    createdAt: null,
    // The API only orders by "undiscovered"; it cannot tell us an asset is
    // undiscovered, and it never exposes download counts, so every asset
    // stays "unknown" unless a future provider exposes the real classification.
    status: 'unknown',
    width: typeof file.width === 'number' ? file.width : null,
    height: typeof file.height === 'number' ? file.height : null,
    category: typeof file.category === 'string' ? file.category : file.category && typeof file.category === 'object' ? file.category.name ?? null : null,
    categoryHierarchy: formatCategoryHierarchy(file.category_hierarchy),
    description: file.description ?? null,
    isTransparent: typeof file.is_transparent === 'boolean' ? file.is_transparent : null,
    isGenerativeAI: typeof file.is_gentech === 'boolean' ? file.is_gentech : null,
    popularity: null,
    observationCount: null,
    firstSeenAt: null,
    lastSeenAt: null,
  };
}

/**
 * Adobe returns `category_hierarchy` as an ordered array of { name } objects
 * (broadest category first) or, occasionally, a pre-formatted string.
 * Normalize to a single "Broad / Narrow / Narrowest" path when possible.
 */
function formatCategoryHierarchy(hierarchy: AdobeStockApiFile['category_hierarchy']): string | null {
  if (typeof hierarchy === 'string' && hierarchy.trim() !== '') return hierarchy;
  if (Array.isArray(hierarchy)) {
    const names = hierarchy
      .map((entry) => (entry && typeof entry === 'object' && 'name' in entry ? String((entry as { name?: unknown }).name ?? '') : ''))
      .filter((name) => name.length > 0);
    return names.length > 0 ? names.join(' / ') : null;
  }
  return null;
}

/**
 * Best-effort content-type mapping based on the fields the API returns.
 *
 * Adobe's documented media_type_id enum is 1=photo, 2=illustration,
 * 3=vector, 4=video, 6=3D, 7=template. The MIME `content_type` is used as a
 * tiebreaker for values Adobe may omit.
 */
function mapContentType(file: AdobeStockApiFile): ContentType {
  const mediaType = file.media_type_id;
  const ct = (file.content_type ?? '').toLowerCase();

  if (mediaType === 4 || ct.includes('video')) return 'video';
  if (mediaType === 7 || ct.includes('template')) return 'template';
  if (mediaType === 6 || ct.includes('3d')) return '3d';
  if (mediaType === 5 || ct.includes('audio')) return 'audio';

  if (mediaType === 3 || file.vector_type) return 'vector';
  if (mediaType === 2 || ct.includes('illustrator') || ct.includes('photoshop')) return 'illustration';
  if (mediaType === 1 || ct.includes('tiff') || ct.includes('jpeg') || ct.includes('png')) return 'photo';
  return 'unknown';
}

function creatorFromApiFailure(params: FetchCreatorAssetsParams, result: AdobeStockApiSearchResult): CreatorAssetsResult {
  switch (result.status) {
    case 'rate_limited':
      return creatorEmpty(params, 'rate_limited', result.message, 'adobe-stock-api');
    case 'blocked':
      return creatorEmpty(params, 'blocked', result.message, 'adobe-stock-api');
    case 'timeout':
      return creatorEmpty(params, 'timeout', 'The request to the Adobe Stock API timed out.', 'adobe-stock-api');
    case 'error':
      return creatorEmpty(params, 'error', result.message ?? 'The Adobe Stock API could not be reached.', 'adobe-stock-api');
    default:
      return creatorEmpty(params, 'error', 'The Adobe Stock API could not be reached.', 'adobe-stock-api');
  }
}

function creatorEmpty(
  params: FetchCreatorAssetsParams,
  source: SourceStatus,
  sourceMessage: string,
  provider: string,
): CreatorAssetsResult {
  return {
    creatorId: params.creatorId,
    assets: [],
    total: null,
    page: params.page,
    pageSize: params.limit,
    hasMore: false,
    source,
    sourceMessage,
    provider,
  };
}

function assetSearchFromApiFailure(params: AssetSearchParams, result: AdobeStockApiSearchResult): AssetSearchResult {
  switch (result.status) {
    case 'rate_limited':
      return assetSearchEmpty(params, 'rate_limited', result.message, 'adobe-stock-api');
    case 'blocked':
      return assetSearchEmpty(params, 'blocked', result.message, 'adobe-stock-api');
    case 'timeout':
      return assetSearchEmpty(params, 'timeout', 'The request to the Adobe Stock API timed out.', 'adobe-stock-api');
    case 'error':
      return assetSearchEmpty(params, 'error', result.message ?? 'The Adobe Stock API could not be reached.', 'adobe-stock-api');
    default:
      return assetSearchEmpty(params, 'error', 'The Adobe Stock API could not be reached.', 'adobe-stock-api');
  }
}

function assetSearchEmpty(
  params: AssetSearchParams,
  source: SourceStatus,
  sourceMessage: string,
  provider: string,
): AssetSearchResult {
  return {
    query: params.query,
    assets: [],
    total: null,
    page: params.page,
    pageSize: params.limit,
    hasMore: false,
    source,
    sourceMessage,
    provider,
  };
}

function metadataFromApiFailure(
  result: AdobeStockApiSearchResult,
): Pick<AssetMetadataResult, 'source' | 'sourceMessage'> {
  switch (result.status) {
    case 'rate_limited':
      return { source: 'rate_limited', sourceMessage: result.message };
    case 'blocked':
      return { source: 'blocked', sourceMessage: result.message };
    case 'timeout':
      return { source: 'timeout', sourceMessage: 'The request to the Adobe Stock API timed out.' };
    case 'error':
      return { source: 'error', sourceMessage: result.message ?? 'The Adobe Stock API could not be reached.' };
    default:
      return { source: 'error', sourceMessage: 'The Adobe Stock API could not be reached.' };
  }
}

function licenseHistoryUnauthorized(source: SourceStatus, message: string, provider: string): LicenseHistoryResult {
  return {
    entries: [],
    total: null,
    scanned: 0,
    truncated: false,
    page: 1,
    pageSize: 100,
    hasMore: false,
    authorized: false,
    source,
    sourceMessage: message,
    provider,
  };
}

function licenseHistoryFromFailure(result: AdobeStockApiSearchResult, provider: string): LicenseHistoryResult {
  let source: SourceStatus = 'error';
  let message = 'The Adobe Stock License History API could not be reached.';
  switch (result.status) {
    case 'rate_limited':
      source = 'rate_limited';
      message = result.message ?? 'Adobe Stock API rate-limited the License History request.';
      break;
    case 'timeout':
      source = 'timeout';
      message = 'The request to the Adobe Stock License History API timed out.';
      break;
    case 'blocked':
      source = 'blocked';
      message = result.message;
      break;
    case 'error':
      source = 'error';
      message = result.message ?? 'The Adobe Stock License History API could not be reached.';
      break;
    case 'ok':
      break;
  }
  return {
    entries: [],
    total: null,
    scanned: 0,
    truncated: false,
    page: 1,
    pageSize: 100,
    hasMore: false,
    authorized: true,
    source,
    sourceMessage: message,
    provider,
  };
}

/** Map a License History file object to the normalized entry shape. */
function mapLicenseFileToEntry(file: AdobeStockApiFile): LicenseHistoryEntry {
  return {
    assetId: file.id !== undefined ? String(file.id) : '',
    title: file.title ?? null,
    thumbnailUrl: file.thumbnail_500_url ?? file.thumbnail_1000_url ?? file.thumbnail_url ?? null,
    detailsUrl: file.details_url ?? null,
    creatorId: file.creator_id !== undefined ? String(file.creator_id) : null,
    creatorName: file.creator_name ?? null,
    contentType: file.content_type ?? null,
    licenseType: file.license ?? null,
    licenseDate: parseAdobeLicenseDate(file.license_date),
    licenseDateRaw: file.license_date ?? null,
    downloadUrl: file.download_url ?? null,
  };
}

/** Parse Adobe's locale-formatted license date ("M/d/yyyy h:mm:ss tt") to ISO. */
function parseAdobeLicenseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function applyLicenseHistoryFilters(entries: LicenseHistoryEntry[], params: LicenseHistoryParams): LicenseHistoryEntry[] {
  const query = (params.query ?? '').trim().toLowerCase();
  const from = params.from ? parseIsoDate(params.from) : null;
  const to = params.to ? parseIsoDate(params.to) : null;

  return entries.filter((entry) => {
    if (query) {
      const haystack = [entry.title, entry.creatorName, entry.assetId, entry.licenseType]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    const licensedAt = entry.licenseDate ? parseIsoDate(entry.licenseDate) : null;
    if (from && (!licensedAt || licensedAt < from)) return false;
    if (to && (!licensedAt || licensedAt > to)) return false;
    return true;
  });
}

/** Parse "YYYY-MM-DD" (or a full ISO date) into a midnight-UTC timestamp. */
function parseIsoDate(value: string): number | null {
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/**
 * Honest per-field availability for a provider. The official public Adobe
 * Stock API never exposes another contributor's downloads, acceptance data,
 * upload dates, or sales reports — those are always declared unavailable.
 */
function buildCreatorAvailability(input: {
  officialApiAvailable: boolean;
  exposesDownloadCounts: boolean;
  providerName: string;
}): CreatorAvailability {
  const provider = input.providerName;
  return {
    officialApiAvailable: input.officialApiAvailable,
    downloadData: input.exposesDownloadCounts
      ? { status: 'available', message: 'Exact download counts are provided by this data source.' }
      : {
          status: 'not_provided',
          message:
            'Download data unavailable — another contributor\u2019s total or per-asset download counts are not provided by the official Adobe Stock Search API.',
        },
    acceptanceData: {
      status: 'not_provided',
      message:
        'Contributor acceptance data unavailable — accepted/rejected files and review status are not provided by the official public Contributor API.',
    },
    uploadHistory: {
      status: 'not_provided',
      message: 'Upload date unavailable — exact upload dates are not provided by the official public Stock API.',
    },
    salesHistory: {
      status: 'not_provided',
      message:
        'Weekly contributor sales unavailable — weekly downloads, earnings, and revenue reports are not provided by the official public Adobe Stock API.',
    },
  };
}
