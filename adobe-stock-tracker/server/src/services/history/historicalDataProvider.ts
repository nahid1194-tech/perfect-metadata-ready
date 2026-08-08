import { config } from '../../config';
import { isDatabaseConfigured } from '../../db/client';
import type { AdobeStockAsset } from '../adobeStock/adobeStockTypes';
import { MemoryHistoryStore, PrismaHistoryStore } from './historyStore';
import type {
  AssetTracking,
  CreatorKeywordCount,
  CreatorOverview,
  HistoryStore,
  KeywordAnalytics,
  ObservationPoint,
  SaveObservationInput,
  SummaryStats,
} from './types';

export type HistoryRange = '7d' | '30d' | '90d' | 'all';

export interface HistoryPoint {
  observedAt: string;
  value: number | null;
  source: string;
}

export interface AssetHistoryResult {
  assetId: string;
  /** False when no persistence is configured (session-only store). */
  available: boolean;
  /** Store label surfaced to the UI, e.g. "PostgreSQL database". */
  storeLabel: string;
  range: HistoryRange;
  points: HistoryPoint[];
  current: number | null;
  previous: number | null;
  change: number | null;
  changePercent: number | null;
  /** "Exact downloads" when the source provides counts, else "Popularity signal". */
  metricLabel: string;
  notice?: string;
}

const RANGE_MS: Record<Exclude<HistoryRange, 'all'>, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

/**
 * Historical analytics facade.
 *
 * Persists point-in-time observations of asset metrics over time and answers
 * "how has this asset changed" questions. The store (PostgreSQL or session
 * memory) only records what a data source actually provides:
 *   - exact download counts when the source exposes them,
 *   - a clearly-labeled "popularity signal" (ranking percentile) otherwise.
 * Estimated values are never presented as real download counts.
 */
export class HistoricalDataProvider {
  readonly store: HistoryStore;

  constructor(store: HistoryStore) {
    this.store = store;
  }

  get available(): boolean {
    return this.store.available;
  }

  get storeLabel(): string {
    return this.store.label;
  }

  async saveObservation(input: SaveObservationInput): Promise<void> {
    await this.store.saveObservation(input);
  }

  /** Index a batch of fetched assets locally (upserts, never duplicates). */
  async trackAssets(assets: AdobeStockAsset[]): Promise<void> {
    await this.store.upsertAssets(assets);
  }

  async trackCreator(input: { adobeCreatorId: string; creatorName?: string | null; portfolioUrl?: string | null }): Promise<void> {
    await this.store.upsertCreator(input);
  }

  async recordSearch(query: string, searchType: string): Promise<void> {
    await this.store.recordSearch(query, searchType);
  }

  async getTrackedCreators(): Promise<Array<{ adobeCreatorId: string; creatorName: string | null }>> {
    return this.store.getTrackedCreators();
  }

  async getAssetTracking(adobeAssetId: string): Promise<AssetTracking | null> {
    return this.store.getAssetTracking(adobeAssetId);
  }

  /**
   * Save a batch of point-in-time observations, throttled so the same asset
   * is only observed once per interval (default: OBSERVATION_INTERVAL_MS).
   * This keeps repeated searches from bloating the observation history.
   */
  async recordObservationBatch(
    inputs: SaveObservationInput[],
    throttleWithinMs?: number,
  ): Promise<{ recorded: number; skipped: number }> {
    const valid = inputs.filter((input) => input.adobeAssetId.length > 0);
    if (valid.length === 0) return { recorded: 0, skipped: 0 };
    const window = throttleWithinMs ?? config.scheduler.intervalMs;
    const since = new Date(Date.now() - window);
    const recent = await this.store.getRecentObservationKeys(
      valid.map((input) => input.adobeAssetId),
      since,
    );

    let recorded = 0;
    let skipped = 0;
    for (const input of valid) {
      if (recent.has(input.adobeAssetId)) {
        skipped += 1;
        continue;
      }
      await this.store.saveObservation(input);
      recorded += 1;
    }
    return { recorded, skipped };
  }

  async getSummary(): Promise<SummaryStats> {
    return this.store.getSummary();
  }

  async getTopKeywords(limit: number): Promise<CreatorKeywordCount[]> {
    return this.store.getTopKeywords(limit);
  }

  async getKeywordAnalytics(limit: number): Promise<KeywordAnalytics> {
    return this.store.getKeywordAnalytics(limit);
  }

  async getCreatorOverview(adobeCreatorId: string, limit: number): Promise<CreatorOverview | null> {
    return this.store.getCreatorOverview(adobeCreatorId, limit);
  }

  /** Merge local tracking (first/last seen, observation count) into assets. */
  async enrichWithTracking(assets: AdobeStockAsset[]): Promise<AdobeStockAsset[]> {
    const ids = assets.map((a) => a.id).filter((id) => id.length > 0);
    if (ids.length === 0) return assets;
    const tracking = await this.store.getTrackingBatch(ids);
    return assets.map((asset) => {
      const t = tracking[asset.id];
      if (!t) return asset;
      return {
        ...asset,
        observationCount: t.observationCount,
        firstSeenAt: t.firstSeenAt,
        lastSeenAt: t.lastSeenAt,
      };
    });
  }

  async getObservationStats(adobeAssetIds: string[]): Promise<{ assetsWithObservations: number; totalObservations: number }> {
    return this.store.getObservationStats(adobeAssetIds);
  }

  async getHistory(assetId: string, range: HistoryRange): Promise<AssetHistoryResult> {
    const since = range === 'all' ? null : new Date(Date.now() - RANGE_MS[range]);
    const points = await this.store.getAssetObservations(assetId, since);
    const sorted = points
      .map((p) => ({ observedAt: p.observedAt, value: p.value, source: p.source }))
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt));

    const last = sorted.length > 0 ? sorted[sorted.length - 1] : undefined;
    const first = sorted.length > 1 ? sorted[0] : undefined;
    const current = last?.value ?? null;
    const previous = first?.value ?? null;
    const change = current !== null && previous !== null ? current - previous : null;
    const changePercent = previous !== null && previous > 0 && current !== null ? (change! / previous) * 100 : null;

    const lastSource = last?.source ?? '';
    const metricLabel =
      lastSource === 'official-api-exact' ? 'Exact downloads' : lastSource === 'popularity-signal' ? 'Popularity signal' : 'Observed metric';

    return {
      assetId,
      available: this.store.available,
      storeLabel: this.store.label,
      range,
      points: sorted,
      current,
      previous,
      change,
      changePercent,
      metricLabel,
      notice: this.store.available
        ? undefined
        : 'Historical database is not configured — observations shown here are session-only and not persisted. Set DATABASE_URL to enable persistent history.',
    };
  }
}

let provider: HistoricalDataProvider | null = null;

/** Singleton: PostgreSQL-backed when configured, session-only otherwise. */
export function getHistoryProvider(): HistoricalDataProvider {
  if (!provider) {
    provider = new HistoricalDataProvider(isDatabaseConfigured() ? new PrismaHistoryStore() : new MemoryHistoryStore());
  }
  return provider;
}
