/**
 * Shared types for the Adobe Stock data-source layer.
 *
 * These types describe the *normalized internal format* the rest of the
 * application consumes. They are intentionally provider-agnostic: any data
 * provider (the official Adobe Stock API today, a compliant alternative
 * later) must return this shape.
 */

export type ContentType =
  | 'photo'
  | 'illustration'
  | 'vector'
  | 'video'
  | 'template'
  | '3d'
  | 'audio'
  | 'unknown';

export type AssetStatus = 'downloaded' | 'undownloaded' | 'unknown';

export type SortOption = 'downloads-desc' | 'downloads-asc' | 'creation-desc' | 'creation-asc';

export type FilterOption = 'all' | 'downloaded' | 'undiscovered' | 'recent' | 'transparent' | 'vector';

export type ContentTypeFilter = 'all' | Exclude<ContentType, 'unknown' | 'audio'>;

/**
 * The five always-available search links a dashboard opens directly on
 * stock.adobe.com. These mirror the reference extension's filter buttons.
 */
export type SearchLinkFilter = 'downloaded' | 'undownloaded' | 'recent' | 'png' | 'vector';

/**
 * Where the provider gets its data. "link" providers only generate
 * stock.adobe.com search URLs (opened in the user's browser) and never
 * fetch data; "api" providers fetch normalized asset data directly.
 */
export type ProviderMode = 'api' | 'link';

/** A single generated stock.adobe.com search URL for a creator. */
export interface CreatorSearchLinks {
  creatorId: string;
  /** All-types view, ordered by downloads (matches the extension default). */
  base: string;
  /** Primary "View on Adobe Stock" URL (currently the same as base). */
  viewUrl: string;
  /** One URL per filter button. */
  filters: Record<SearchLinkFilter, string>;
}

/** Wire shape returned by GET /api/creator/:creatorId/links. */
export interface CreatorSearchLinksResponse extends CreatorSearchLinks {
  mode: ProviderMode;
  provider: string;
}

/** Sort options for Asset/Title search. */
export type AssetSearchSort = 'relevance' | 'downloads' | 'newest' | 'undiscovered';

/** Single-select content filter for Asset/Title search. */
export type AssetSearchFilter =
  | 'all'
  | 'photo'
  | 'illustration'
  | 'vector'
  | 'transparent'
  | 'video'
  | 'template'
  | '3d'
  | 'ai';

/**
 * A clearly-labeled popularity estimate derived from Adobe's own ranking.
 *
 * The official Adobe Stock API does not expose download counts, but when a
 * query is ordered by `nb_downloads` (or `undiscovered`) the returned order
 * IS Adobe's popularity ranking. This signal records that rank honestly — it
 * is never presented as a real download count.
 */
export interface AssetPopularitySignal {
  /** 1-based position within the returned result set. */
  rank: number;
  /** Number of results the rank is relative to. */
  total: number;
  /** 0–100 percentile of popularity within that result set. */
  percentile: number;
}

/** Result of a single-asset (media_id) lookup. */
export interface AssetMetadataResult {
  /** The asset, or null when the source could not provide it. */
  asset: AdobeStockAsset | null;
  /** Generated stock.adobe.com URL to open in link mode (never fetched). */
  link: string | null;
  source: SourceStatus;
  sourceMessage?: string;
  notice?: string;
  provider?: string;
}

export interface AssetSearchParams {
  /** Free-text search phrase (title, keyword, or Adobe Stock search phrase). */
  query: string;
  filter: AssetSearchFilter;
  sort: AssetSearchSort;
  page: number;
  limit: number;
}

/** Normalized result of an Asset/Title search (mirrors CreatorAssetsResult). */
export interface AssetSearchResult {
  query: string;
  assets: AdobeStockAsset[];
  /** Total number of matching assets, when the source exposes it. Null otherwise. */
  total: number | null;
  page: number;
  pageSize: number;
  hasMore: boolean;
  source: SourceStatus;
  sourceMessage?: string;
  notice?: string;
  provider?: string;
}

/** Generated stock.adobe.com keyword-search URLs for an Asset/Title query. */
export interface AssetSearchLinks {
  kind: 'asset';
  query: string;
  /** Default keyword search page (relevance, all content types). */
  base: string;
  /** Primary "Open on Adobe Stock" URL (currently the same as base). */
  viewUrl: string;
  /** One URL per sort option. */
  sort: Record<AssetSearchSort, string>;
  /** One URL per content filter. */
  filters: Record<AssetSearchFilter, string>;
}

/** Wire shape returned by GET /api/search/links. */
export interface AssetSearchLinksResponse extends AssetSearchLinks {
  mode: ProviderMode;
  provider: string;
}

/** How a request against the upstream data source ended up. */
export type SourceStatus =
  | 'ok'
  | 'empty'
  | 'unavailable'
  | 'blocked'
  | 'rate_limited'
  | 'timeout'
  | 'error';

/** Honest availability for a category of data the dashboard is asked about. */
export type AvailabilityStatus = 'available' | 'unavailable' | 'not_provided' | 'not_authorized';

/**
 * Per-field availability for the creator dashboard. Every value is derived
 * from the provider's declared capabilities and configuration, never guessed.
 */
export interface CreatorAvailability {
  /** true when the official Adobe Stock API is configured and reachable. */
  officialApiAvailable: boolean;
  /** Another contributor's download counts / sales data. */
  downloadData: { status: AvailabilityStatus; message: string };
  /** Accepted/rejected files, review status, acceptance history. */
  acceptanceData: { status: AvailabilityStatus; message: string };
  /** Exact upload dates / upload history. */
  uploadHistory: { status: AvailabilityStatus; message: string };
  /** Weekly contributor sales / downloads / earnings reports. */
  salesHistory: { status: AvailabilityStatus; message: string };
}

/**
 * Declares what a provider can honestly deliver. The dashboard uses these
 * flags to avoid deriving numbers the source cannot actually produce.
 */
export interface AdobeStockProviderCapabilities {
  /**
   * true when the provider's "undiscovered" query filters the result set
   * (so its total can be subtracted from the "all" total).
   * The official Adobe Stock API treats "undiscovered" as an *ordering*,
   * not a filter, so this must stay false there.
   */
  canPartitionDiscovered?: boolean;
  /** true when the provider exposes real per-asset download counts. */
  exposesDownloadCounts?: boolean;
}

export interface AdobeStockAsset {
  /** Unique asset identifier. Only populated when the source provides one. */
  id: string;
  title: string | null;
  /** Direct thumbnail image URL, when the source exposes one. */
  thumbnail: string | null;
  /** Link to view the asset on Adobe Stock. */
  assetUrl: string | null;
  creatorId: string;
  /** Display name of the contributing creator, when the source exposes it. */
  creatorName: string | null;
  /** Upstream keyword tags, when the source exposes them. */
  keywords: string[] | null;
  contentType: ContentType;
  /** Exact download count, only when the source exposes it reliably. Null otherwise. */
  downloads: number | null;
  /** ISO date string of the creation/upload date, when available. Null otherwise. */
  createdAt: string | null;
  /**
   * Downloaded/undownloaded classification.
   * "downloaded"  -> source reports a positive download count.
   * "undiscovered"-> source reports the asset as undiscovered (zero/low downloads).
   * "unknown"     -> the source does not expose reliable per-asset info.
   */
  status: AssetStatus;
  /** Pixel width, when the source exposes it. Null otherwise. */
  width: number | null;
  /** Pixel height, when the source exposes it. Null otherwise. */
  height: number | null;
  /** Category name (e.g. "Dogs"), when the source exposes it. Null otherwise. */
  category: string | null;
  /** Category hierarchy path, when the source exposes it. Null otherwise. */
  categoryHierarchy: string | null;
  /** Asset description, when the source exposes it. Null otherwise. */
  description: string | null;
  /** Transparent-background flag, when the source exposes it. Null otherwise. */
  isTransparent: boolean | null;
  /** Generative-AI flag, when the source exposes it. Null otherwise. */
  isGenerativeAI: boolean | null;
  /**
   * Clearly-labeled popularity signal derived from Adobe's ranking order.
   * Present only when the query was ordered by popularity. Never a real count.
   */
  popularity: AssetPopularitySignal | null;
  /** Number of stored historical observations, when a history store exists. */
  observationCount: number | null;
  /** First time this asset was seen locally (history store). */
  firstSeenAt: string | null;
  /** Last time this asset was seen locally (history store). */
  lastSeenAt: string | null;
}

export interface CreatorAssetsResult {
  creatorId: string;
  assets: AdobeStockAsset[];
  /** Total number of matching assets, when the source exposes it. Null otherwise. */
  total: number | null;
  page: number;
  pageSize: number;
  hasMore: boolean;
  source: SourceStatus;
  /** Human readable explanation for non-ok source states. */
  sourceMessage?: string;
  /** Honest informational note for ok results (e.g. API field limitations). */
  notice?: string;
  /** Machine-readable name of the provider that produced this result. */
  provider?: string;
}

export interface FetchCreatorAssetsParams {
  creatorId: string;
  filter: FilterOption;
  sort: SortOption;
  contentType: ContentTypeFilter;
  page: number;
  limit: number;
}

export interface CreatorStatsResult {
  creatorId: string;
  /** Total public assets, when derivable from the source. Null otherwise. */
  totalAssets: number | null;
  /** Assets with a positive download count, when derivable. Null otherwise. */
  downloadedAssets: number | null;
  /** Undiscovered / zero-download assets, when derivable. Null otherwise. */
  undownloadedAssets: number | null;
  /** Sum of download counts, when counts are reliably exposed. Null otherwise. */
  totalDownloads: number | null;
  /** True when totalDownloads only covers a subset of the creator's assets. */
  totalDownloadsIsPartial?: boolean;
  source: SourceStatus;
  sourceMessage?: string;
  notice?: string;
  provider?: string;
}

/**
 * Parameters for the License History endpoint (the authenticated user's own
 * licensing history). `query`/`from`/`to` are applied by THIS app over the
 * scanned history because Adobe's License History API does not filter
 * server-side by date or free text.
 */
export interface LicenseHistoryParams {
  /** Free-text filter over the scanned history (title / creator / asset ID). */
  query?: string;
  /** Inclusive start of the license-date window (ISO date, YYYY-MM-DD). */
  from?: string;
  /** Inclusive end of the license-date window (ISO date, YYYY-MM-DD). */
  to?: string;
  page: number;
  limit: number;
}

/** One licensed asset in the authenticated user's license history. */
export interface LicenseHistoryEntry {
  assetId: string;
  title: string | null;
  thumbnailUrl: string | null;
  /** Public details URL on stock.adobe.com. */
  detailsUrl: string | null;
  creatorId: string | null;
  creatorName: string | null;
  contentType: string | null;
  /** License type ("Standard", "Extended", "Video_HD", …), when provided. */
  licenseType: string | null;
  /** License date as an ISO string, when parseable. */
  licenseDate: string | null;
  /** License date exactly as Adobe returned it. */
  licenseDateRaw: string | null;
  /** Licensed download URL (authenticated); empty unless the API provides it. */
  downloadUrl: string | null;
}

export interface LicenseHistoryResult {
  entries: LicenseHistoryEntry[];
  /** Total licensed assets Adobe reports (unfiltered `nb_results`). */
  total: number | null;
  /** How many entries were scanned to apply query/date filters. */
  scanned: number;
  /** True when `total` exceeds what was scanned (scan cap reached). */
  truncated: boolean;
  page: number;
  pageSize: number;
  hasMore: boolean;
  /** false when no authorized account is connected. */
  authorized: boolean;
  source: SourceStatus;
  sourceMessage?: string;
  notice?: string;
  provider?: string;
}
