import type { AdobeStockAsset } from '../adobeStock/adobeStockTypes';

/** One stored point-in-time observation for an asset. */
export interface ObservationPoint {
  observedAt: string;
  /** Exact download count ONLY when the source provides it. Null otherwise. */
  value: number | null;
  /** Honest provenance, e.g. "official-api-exact" or "popularity-signal". */
  source: string;
}

/** Local indexing info for a single asset. */
export interface AssetTracking {
  adobeAssetId: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  observationCount: number;
}

export interface SaveObservationInput {
  adobeAssetId: string;
  observedAt?: Date;
  /** Exact download count, when the data source actually provides one. */
  availableDownloadMetric?: number | null;
  /** Ranking-derived popularity percentile, when that is what was observed. */
  popularitySignal?: number | null;
  /** Provenance: 'official-api-exact' | 'popularity-signal' | ... */
  source: string;
  confidence?: number;
  asset?: Pick<
    AdobeStockAsset,
    | 'title'
    | 'creatorId'
    | 'creatorName'
    | 'thumbnail'
    | 'assetUrl'
    | 'contentType'
    | 'width'
    | 'height'
    | 'keywords'
    | 'category'
    | 'isTransparent'
    | 'isGenerativeAI'
  >;
}

export interface CreatorUpsert {
  adobeCreatorId: string;
  creatorName?: string | null;
  portfolioUrl?: string | null;
}

/** Dashboard summary cards: totals across the local index. */
export interface SummaryStats {
  /** Distinct assets indexed locally. */
  totalAssets: number;
  /** Assets that have at least one observation. */
  indexedAssets: number;
  /** Assets with at least one usable metric point (exact or popularity). */
  assetsWithAvailableMetrics: number;
  /** Total stored historical observations. */
  totalObservations: number;
}

export interface CreatorContentTypeCount {
  contentType: string;
  count: number;
}

export interface CreatorTopAsset {
  adobeAssetId: string;
  title: string | null;
  thumbnailUrl: string | null;
  /** Value of the latest observation, when one exists. */
  lastValue: number | null;
  /** Provenance of that latest value ("official-api-exact" | "popularity-signal"). */
  lastValueSource: string | null;
}

export interface CreatorKeywordCount {
  keyword: string;
  count: number;
}

/** Creator dashboard data assembled from the local index. */
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

export interface KeywordAnalytics {
  keywords: CreatorKeywordCount[];
  /** Number of distinct assets the keyword stats were derived from. */
  totalAssets: number;
  /** "database" when persisted, "session" for the in-memory store. */
  source: 'database' | 'session';
}

/**
 * Persistence contract for historical observations.
 *
 * Implemented by a PostgreSQL-backed store (Prisma) when DATABASE_URL is set
 * and by a session-only in-memory store otherwise. Every method must behave
 * honestly in both — the in-memory store is explicitly labeled as not
 * persisted.
 */
export interface HistoryStore {
  readonly available: boolean;
  /** Human-readable label surfaced to the UI, e.g. "PostgreSQL database". */
  readonly label: string;
  saveObservation(input: SaveObservationInput): Promise<void>;
  getAssetObservations(adobeAssetId: string, since: Date | null): Promise<ObservationPoint[]>;
  /** Which of the given asset IDs already have an observation on/after `since`. */
  getRecentObservationKeys(assetIds: string[], since: Date): Promise<Set<string>>;
  getAssetTracking(adobeAssetId: string): Promise<AssetTracking | null>;
  getTrackingBatch(adobeAssetIds: string[]): Promise<Record<string, AssetTracking>>;
  upsertAsset(asset: AdobeStockAsset): Promise<void>;
  upsertAssets(assets: AdobeStockAsset[]): Promise<void>;
  upsertCreator(creator: CreatorUpsert): Promise<void>;
  recordSearch(query: string, searchType: string): Promise<void>;
  getTrackedCreators(): Promise<Array<{ adobeCreatorId: string; creatorName: string | null }>>;
  getObservationStats(adobeAssetIds: string[]): Promise<{ assetsWithObservations: number; totalObservations: number }>;
  getSummary(): Promise<SummaryStats>;
  getTopKeywords(limit: number): Promise<CreatorKeywordCount[]>;
  getCreatorOverview(adobeCreatorId: string, limit: number): Promise<CreatorOverview | null>;
  getKeywordAnalytics(limit: number): Promise<KeywordAnalytics>;
}
