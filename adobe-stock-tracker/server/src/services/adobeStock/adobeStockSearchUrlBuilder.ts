import type { AssetSearchFilter, AssetSearchLinks, AssetSearchSort, CreatorSearchLinks, SearchLinkFilter } from './adobeStockTypes';

export interface AdobeStockSearchLinkOptions {
  /** Base search URL, e.g. https://stock.adobe.com/search */
  baseUrl: string;
  creatorId: string;
  limit?: number;
}

export interface AdobeStockAssetSearchLinkOptions {
  /** Base search URL, e.g. https://stock.adobe.com/search */
  baseUrl: string;
  query: string;
  limit?: number;
}

const DEFAULT_LIMIT = 100;

/**
 * Content-type / pagination parameters preserved on every generated link.
 * They match the reference Chrome extension's common query fragment.
 */
const COMMON_FILTERS: ReadonlyArray<[string, string]> = [
  ['filters[content_type:photo]', '1'],
  ['filters[content_type:illustration]', '1'],
  ['filters[content_type:zip_vector]', '1'],
  ['filters[content_type:video]', '1'],
  ['filters[content_type:template]', '1'],
  ['filters[content_type:3d]', '1'],
  ['filters[content_type:audio]', '0'],
  ['filters[include_stock_enterprise]', '0'],
  ['filters[is_editorial]', '0'],
  ['filters[fetch_excluded_assets]', '1'],
  ['filters[content_type:image]', '1'],
];

/** Extra query parameters per filter button. */
const FILTER_EXTRAS: Record<SearchLinkFilter, ReadonlyArray<[string, string]>> = {
  downloaded: [['order', 'nb_downloads']],
  undownloaded: [
    ['filters[undiscovered]', 'only'],
    ['order', 'nb_downloads'],
  ],
  recent: [['order', 'creation']],
  png: [
    ['filters[transparent]', 'only'],
    ['order', 'nb_downloads'],
  ],
  vector: [
    ['filters[content_type:zip_vector]', '1'],
    ['order', 'nb_downloads'],
  ],
};

function encodeParams(entries: ReadonlyArray<[string, string]>): string {
  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

/**
 * Builds a stock.adobe.com search URL for a creator + filter. The URL is
 * generated and opened in the user's browser; the backend never fetches it.
 */
export function buildAdobeStockSiteSearchUrl(
  options: AdobeStockSearchLinkOptions,
  filter: SearchLinkFilter,
): string {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const pairs: Array<[string, string]> = [
    ['creator_id', options.creatorId],
    ...COMMON_FILTERS,
    ...FILTER_EXTRAS[filter],
    ['limit', String(limit)],
    ['search_page', '1'],
    ['search_type', 'pagination'],
    ['get_facets', '0'],
  ];
  const base = options.baseUrl.replace(/\/+$/, '');
  return `${base}?${encodeParams(pairs)}`;
}

/** Builds the full set of search links for a creator. */
export function buildCreatorSearchLinks(
  options: AdobeStockSearchLinkOptions,
): CreatorSearchLinks {
  const filterKeys: SearchLinkFilter[] = ['downloaded', 'undownloaded', 'recent', 'png', 'vector'];
  const filters = {} as Record<SearchLinkFilter, string>;
  for (const key of filterKeys) {
    filters[key] = buildAdobeStockSiteSearchUrl(options, key);
  }
  const base = buildAdobeStockSiteSearchUrl(options, 'downloaded');
  return { creatorId: options.creatorId, base, viewUrl: base, filters };
}

/** Extra query parameters per Asset-search sort option. */
const ASSET_SORT_EXTRAS: Record<AssetSearchSort, ReadonlyArray<[string, string]>> = {
  relevance: [['order', 'relevance']],
  downloads: [['order', 'nb_downloads']],
  newest: [['order', 'creation']],
  undiscovered: [['order', 'undiscovered']],
};

/** Extra query parameters per Asset-search content filter. */
const ASSET_FILTER_EXTRAS: Record<AssetSearchFilter, ReadonlyArray<[string, string]>> = {
  all: [],
  photo: [['filters[content_type:photo]', '1']],
  illustration: [['filters[content_type:illustration]', '1']],
  vector: [['filters[content_type:zip_vector]', '1']],
  transparent: [['filters[transparent]', 'only']],
  video: [['filters[content_type:video]', '1']],
  template: [['filters[content_type:template]', '1']],
  '3d': [['filters[content_type:3d]', '1']],
  ai: [['filters[gentech]', 'only']],
};

function buildAssetSearchPage(
  options: AdobeStockAssetSearchLinkOptions,
  extras: ReadonlyArray<[string, string]>,
): string {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const pairs: Array<[string, string]> = [
    ['k', options.query],
    ...extras,
    ['limit', String(limit)],
    ['search_page', '1'],
    ['search_type', 'pagination'],
    ['get_facets', '0'],
  ];
  const base = options.baseUrl.replace(/\/+$/, '');
  return `${base}?${encodeParams(pairs)}`;
}

/** Builds the full set of stock.adobe.com keyword-search links for a query. */
export function buildAssetSearchLinks(options: AdobeStockAssetSearchLinkOptions): AssetSearchLinks {
  const sort = {} as AssetSearchLinks['sort'];
  const filterKeys: AssetSearchFilter[] = [
    'all',
    'photo',
    'illustration',
    'vector',
    'transparent',
    'video',
    'template',
    '3d',
    'ai',
  ];
  for (const key of Object.keys(ASSET_SORT_EXTRAS) as AssetSearchSort[]) {
    sort[key] = buildAssetSearchPage(options, ASSET_SORT_EXTRAS[key]);
  }
  const filters = {} as AssetSearchLinks['filters'];
  for (const key of filterKeys) {
    filters[key] = buildAssetSearchPage(options, [...ASSET_FILTER_EXTRAS[key], ...ASSET_SORT_EXTRAS.relevance]);
  }
  const base = sort.relevance;
  return { kind: 'asset', query: options.query, base, viewUrl: base, sort, filters };
}

/**
 * Generated stock.adobe.com search URL for a single Asset ID (link mode).
 * Uses the `k=<assetId>` search parameter — Adobe treats media identifiers
 * as valid search words. Generated only; never fetched by the backend.
 */
export function buildAssetIdSearchLink(baseUrl: string, assetId: string, limit?: number): string {
  const pairs: Array<[string, string]> = [
    ['k', assetId],
    ['limit', String(limit ?? DEFAULT_LIMIT)],
    ['search_page', '1'],
    ['search_type', 'pagination'],
    ['get_facets', '0'],
  ];
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}?${encodeParams(pairs)}`;
}
