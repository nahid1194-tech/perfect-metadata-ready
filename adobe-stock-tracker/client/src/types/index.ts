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

export type SearchLinkFilter = 'downloaded' | 'undownloaded' | 'recent' | 'png' | 'vector';

export type ProviderMode = 'api' | 'link';

export interface CreatorSearchLinks {
  creatorId: string;
  mode: ProviderMode;
  provider: string;
  base: string;
  viewUrl: string;
  filters: Record<SearchLinkFilter, string>;
}

export type AssetSearchSort = 'relevance' | 'downloads' | 'newest' | 'undiscovered';

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

export type SearchMode = 'creator' | 'asset' | 'asset-id';

export interface AssetSearchLinks {
  kind: 'asset';
  query: string;
  mode: ProviderMode;
  provider: string;
  base: string;
  viewUrl: string;
  sort: Record<AssetSearchSort, string>;
  filters: Record<AssetSearchFilter, string>;
}

export interface AssetSearchResponse {
  query: string;
  assets: Asset[];
  total: number | null;
  page: number;
  pageSize: number;
  hasMore: boolean;
  source: SourceStatus;
  sourceMessage?: string;
  notice?: string;
  provider?: string;
}

export type SourceStatus =
  | 'ok'
  | 'empty'
  | 'unavailable'
  | 'blocked'
  | 'rate_limited'
  | 'timeout'
  | 'error';

export type AvailabilityStatus = 'available' | 'unavailable' | 'not_provided' | 'not_authorized';

/** Per-field availability for the creator dashboard (never guessed). */
export interface CreatorAvailability {
  officialApiAvailable: boolean;
  downloadData: { status: AvailabilityStatus; message: string };
  acceptanceData: { status: AvailabilityStatus; message: string };
  uploadHistory: { status: AvailabilityStatus; message: string };
  salesHistory: { status: AvailabilityStatus; message: string };
}

/** Response of GET /api/creator/:creatorId/availability. */
export interface CreatorAvailabilityResponse {
  creatorId: string;
  provider: string;
  mode: ProviderMode;
  availability: CreatorAvailability;
}

/**
 * A clearly-labeled popularity estimate derived from Adobe's own ranking.
 * Never presented as a real download count.
 */
export interface AssetPopularitySignal {
  rank: number;
  total: number;
  percentile: number;
}

export interface Asset {
  id: string;
  title: string | null;
  /** Best available thumbnail, resolved server-side (1000 → 500 → default). */
  thumbnail: string | null;
  /** Adobe's 500px thumbnail URL, when available. */
  thumbnail500: string | null;
  /** Adobe's default thumbnail URL, when available. */
  thumbnailUrl: string | null;
  /** Adobe's 1000px thumbnail URL, when available. */
  thumbnail1000: string | null;
  /** Pixel dimensions of the default thumbnail, when available. */
  thumbnailWidth?: number | null;
  thumbnailHeight?: number | null;
  /** Pixel dimensions of the 1000px thumbnail, when available. */
  thumbnail1000Width?: number | null;
  thumbnail1000Height?: number | null;
  /** Smaller preview tiers, when available. */
  thumbnail110Url?: string | null;
  thumbnail160Url?: string | null;
  thumbnail240Url?: string | null;
  /** Model/property release flag, when available. */
  hasReleases?: boolean | null;
  /** Direct compile/download URL, when available. */
  compUrl?: string | null;
  /** Whether the authenticated user has licensed this asset (requires auth). */
  isLicensed?: boolean | null;
  /** Video frame rate (fps) / duration (s), when available. */
  framerate?: number | null;
  duration?: number | null;
  /** File size in bytes, when available. */
  sizeBytes?: number | null;
  /** Premium tier ID / premium flag, when available. */
  premiumLevelId?: number | null;
  isLoop?: boolean | null;
  /** Video preview URLs, when available. */
  videoPreviewUrl?: string | null;
  videoSmallPreviewUrl?: string | null;
  /** Marketing copy / production country, when available. */
  marketingText?: string | null;
  countryName?: string | null;
  /** Template type / category IDs, when available. */
  templateTypeId?: number | null;
  templateCategoryIds?: string[] | null;
  assetUrl: string | null;
  creatorId: string;
  creatorName: string | null;
  keywords: string[] | null;
  contentType: ContentType;
  /** Vector subtype ("zip" / "svg") when Adobe provides it. */
  vectorType?: string | null;
  /** Premium-collection flag, when Adobe provides it. */
  isPremium?: boolean | null;
  downloads: number | null;
  createdAt: string | null;
  status: AssetStatus;
  width: number | null;
  height: number | null;
  category: string | null;
  categoryHierarchy: string | null;
  description: string | null;
  isTransparent: boolean | null;
  isGenerativeAI: boolean | null;
  popularity: AssetPopularitySignal | null;
  observationCount: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

/** Response of GET /api/assets/:assetId (Asset ID search mode). */
export interface AssetMetadataResponse {
  asset: Asset | null;
  link: string | null;
  source: SourceStatus;
  sourceMessage?: string;
  notice?: string;
  provider?: string;
  tracking: { adobeAssetId: string; firstSeenAt: string | null; lastSeenAt: string | null; observationCount: number } | null;
  historyAvailable: boolean;
  storeLabel: string;
}

export interface AssetLinksResponse {
  assetId: string;
  link: string;
  mode: ProviderMode;
  provider: string;
}

export interface CreatorAssetsResponse {
  creatorId: string;
  assets: Asset[];
  total: number | null;
  page: number;
  pageSize: number;
  hasMore: boolean;
  source: SourceStatus;
  sourceMessage?: string;
  notice?: string;
  provider?: string;
}

export interface CreatorStats {
  creatorId: string;
  totalAssets: number | null;
  downloadedAssets: number | null;
  undownloadedAssets: number | null;
  totalDownloads: number | null;
  totalDownloadsIsPartial?: boolean;
  source: SourceStatus;
  sourceMessage?: string;
  notice?: string;
  provider?: string;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export type HistoryRange = '7d' | '30d' | '90d' | 'all';

export interface HistoryPoint {
  observedAt: string;
  value: number | null;
  source: string;
}

/** Response of GET /api/assets/:assetId/history. */
export interface AssetHistoryResult {
  assetId: string;
  available: boolean;
  storeLabel: string;
  range: HistoryRange;
  points: HistoryPoint[];
  current: number | null;
  previous: number | null;
  change: number | null;
  changePercent: number | null;
  /** "Exact downloads" when counts are real, else "Popularity signal". */
  metricLabel: string;
  notice?: string;
}

/** Response of GET /api/analytics/summary. */
export interface SummaryResponse {
  totalAssets: number;
  indexedAssets: number;
  assetsWithAvailableMetrics: number;
  totalObservations: number;
  historyAvailable: boolean;
  storeLabel: string;
  providerMode: ProviderMode;
  provider: string;
}

export interface CreatorKeywordCount {
  keyword: string;
  count: number;
}

export interface CreatorContentTypeCount {
  contentType: string;
  count: number;
}

export interface CreatorTopAsset {
  adobeAssetId: string;
  title: string | null;
  thumbnailUrl: string | null;
  lastValue: number | null;
  lastValueSource: string | null;
}

export interface CreatorOverview {
  adobeCreatorId: string;
  creatorName: string | null;
  portfolioUrl: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  totalIndexedAssets: number;
  contentTypes: CreatorContentTypeCount[];
  topAssets: CreatorTopAsset[];
  topKeywords: CreatorKeywordCount[];
}

export interface CreatorOverviewResponse {
  creatorId: string;
  overview: CreatorOverview | null;
  historyAvailable: boolean;
  storeLabel: string;
  availability: CreatorAvailability;
}

export interface KeywordAnalyticsResponse {
  keywords: CreatorKeywordCount[];
  totalAssets: number;
  source: 'database' | 'session';
  historyAvailable: boolean;
  storeLabel: string;
}

/** One licensed asset in the authenticated account's license history. */
export interface LicenseHistoryEntry {
  assetId: string;
  title: string | null;
  thumbnailUrl: string | null;
  detailsUrl: string | null;
  creatorId: string | null;
  creatorName: string | null;
  contentType: string | null;
  licenseType: string | null;
  licenseDate: string | null;
  licenseDateRaw: string | null;
  downloadUrl: string | null;
}

/** Response of GET /api/license-history. */
export interface LicenseHistoryResponse {
  entries: LicenseHistoryEntry[];
  total: number | null;
  scanned: number;
  truncated: boolean;
  page: number;
  pageSize: number;
  hasMore: boolean;
  authorized: boolean;
  source: SourceStatus;
  sourceMessage?: string;
  notice?: string;
  provider?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface AssetQuery {
  filter?: FilterOption;
  sort?: SortOption;
  contentType?: ContentTypeFilter;
  page?: number;
  limit?: number;
}

/** Response of GET /api/settings (public configuration, no secrets). */
export interface SettingsResponse {
  provider: string;
  providerMode: ProviderMode;
  apiKeyConfigured: boolean;
  apiStatus: 'configured' | 'not_configured';
  product: string;
  locale: string;
  apiBaseUrl: string;
  siteSearchBaseUrl: string;
  licenseHistory: { authorized: boolean };
  database: { enabled: boolean; label: string };
  environment: {
    nodeEnv: string;
    port: number;
    rateLimitMax: number;
    rateLimitWindowMs: number;
    cacheTtlMs: number;
    observationSchedulerEnabled: boolean;
  };
}

/** Result of POST /api/settings/test-connection. */
export type ApiConnectionStatus = 'connected' | 'not_configured' | 'invalid' | 'rate_limited' | 'failed';

export interface TestConnectionResponse {
  status: ApiConnectionStatus;
  latencyMs?: number;
  message: string;
}
