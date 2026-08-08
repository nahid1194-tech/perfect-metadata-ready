import { getPrisma, isDatabaseConfigured } from '../../db/client';
import { Prisma } from '@prisma/client';
import type { AdobeStockAsset } from '../adobeStock/adobeStockTypes';
import type {
  AssetTracking,
  CreatorKeywordCount,
  CreatorOverview,
  CreatorTopAsset,
  CreatorUpsert,
  HistoryStore,
  KeywordAnalytics,
  ObservationPoint,
  SaveObservationInput,
  SummaryStats,
} from './types';

const PORTFOLIO_BASE = 'https://stock.adobe.com/contributor';

function keywordsToJson(asset: { keywords?: AdobeStockAsset['keywords'] }): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return Array.isArray(asset.keywords) ? asset.keywords : Prisma.DbNull;
}

/**
 * PostgreSQL-backed history store (Prisma).
 *
 * Only used when DATABASE_URL is configured. All writes are idempotent
 * upserts so repeated searches never create duplicates.
 */
export class PrismaHistoryStore implements HistoryStore {
  readonly available = true;
  readonly label = 'PostgreSQL database';

  async saveObservation(input: SaveObservationInput): Promise<void> {
    const prisma = getPrisma();
    if (!prisma) return;
    const observedAt = input.observedAt ?? new Date();

    await prisma.$transaction([
      prisma.asset.upsert({
        where: { adobeAssetId: input.adobeAssetId },
        update: {
          lastSeenAt: observedAt,
          ...(input.asset?.title ? { title: input.asset.title } : {}),
          ...(input.asset?.creatorId ? { creatorId: input.asset.creatorId } : {}),
          ...(input.asset?.creatorName ? { creatorName: input.asset.creatorName } : {}),
          ...(input.asset?.thumbnail ? { thumbnailUrl: input.asset.thumbnail } : {}),
          ...(input.asset?.assetUrl ? { detailsUrl: input.asset.assetUrl } : {}),
          ...(input.asset?.contentType ? { contentType: input.asset.contentType } : {}),
          ...(input.asset?.width ? { width: input.asset.width } : {}),
          ...(input.asset?.height ? { height: input.asset.height } : {}),
          ...(input.asset?.category ? { category: input.asset.category } : {}),
          ...(input.asset?.isTransparent !== null && input.asset?.isTransparent !== undefined
            ? { isTransparent: input.asset.isTransparent }
            : {}),
          ...(input.asset?.isGenerativeAI !== null && input.asset?.isGenerativeAI !== undefined
            ? { isGenerativeAI: input.asset.isGenerativeAI }
            : {}),
          keywords: input.asset ? keywordsToJson(input.asset) : undefined,
        },
        create: {
          adobeAssetId: input.adobeAssetId,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
          title: input.asset?.title ?? null,
          creatorId: input.asset?.creatorId ?? null,
          creatorName: input.asset?.creatorName ?? null,
          thumbnailUrl: input.asset?.thumbnail ?? null,
          detailsUrl: input.asset?.assetUrl ?? null,
          contentType: input.asset?.contentType ?? null,
          width: input.asset?.width ?? null,
          height: input.asset?.height ?? null,
          keywords: keywordsToJson(input.asset ?? {}),
          category: input.asset?.category ?? null,
          isTransparent: input.asset?.isTransparent ?? null,
          isGenerativeAI: input.asset?.isGenerativeAI ?? null,
        },
      }),
      prisma.assetObservation.create({
        data: {
          asset: { connect: { adobeAssetId: input.adobeAssetId } },
          observedAt,
          availableDownloadMetric: input.availableDownloadMetric ?? null,
          popularitySignal: input.popularitySignal ?? null,
          source: input.source,
          confidence: input.confidence ?? null,
        },
      }),
    ]);
  }

  async getAssetObservations(adobeAssetId: string, since: Date | null): Promise<ObservationPoint[]> {
    const prisma = getPrisma();
    if (!prisma) return [];
    const rows = await prisma.assetObservation.findMany({
      where: {
        asset: { adobeAssetId },
        ...(since ? { observedAt: { gte: since } } : {}),
      },
      orderBy: { observedAt: 'asc' },
    });
    return rows.map((row) => ({
      observedAt: row.observedAt.toISOString(),
      value: row.availableDownloadMetric ?? row.popularitySignal ?? null,
      source: row.source,
    }));
  }

  async getRecentObservationKeys(assetIds: string[], since: Date): Promise<Set<string>> {
    const prisma = getPrisma();
    if (!prisma) return new Set();
    const uniqueIds = [...new Set(assetIds.filter((id) => id.length > 0))];
    if (uniqueIds.length === 0) return new Set();
    const rows = await prisma.assetObservation.findMany({
      where: { asset: { adobeAssetId: { in: uniqueIds } }, observedAt: { gte: since } },
      select: { asset: { select: { adobeAssetId: true } } },
      distinct: ['assetId'],
    });
    return new Set(rows.map((row) => row.asset.adobeAssetId));
  }

  async getAssetTracking(adobeAssetId: string): Promise<AssetTracking | null> {
    const prisma = getPrisma();
    if (!prisma) return null;
    const asset = await prisma.asset.findUnique({
      where: { adobeAssetId },
      include: { _count: { select: { observations: true } } },
    });
    if (!asset) return null;
    return {
      adobeAssetId,
      firstSeenAt: asset.firstSeenAt.toISOString(),
      lastSeenAt: asset.lastSeenAt.toISOString(),
      observationCount: asset._count.observations,
    };
  }

  async getTrackingBatch(adobeAssetIds: string[]): Promise<Record<string, AssetTracking>> {
    const prisma = getPrisma();
    if (!prisma) return {};
    const uniqueIds = [...new Set(adobeAssetIds.filter((id) => id.length > 0))];
    if (uniqueIds.length === 0) return {};
    const assets = await prisma.asset.findMany({
      where: { adobeAssetId: { in: uniqueIds } },
      select: {
        adobeAssetId: true,
        firstSeenAt: true,
        lastSeenAt: true,
        _count: { select: { observations: true } },
      },
    });
    const result: Record<string, AssetTracking> = {};
    for (const asset of assets) {
      result[asset.adobeAssetId] = {
        adobeAssetId: asset.adobeAssetId,
        firstSeenAt: asset.firstSeenAt.toISOString(),
        lastSeenAt: asset.lastSeenAt.toISOString(),
        observationCount: asset._count.observations,
      };
    }
    return result;
  }

  async upsertAsset(asset: AdobeStockAsset): Promise<void> {
    await this.upsertAssets([asset]);
  }

  async upsertAssets(assets: AdobeStockAsset[]): Promise<void> {
    const prisma = getPrisma();
    if (!prisma) return;
    const valid = assets.filter((a) => a.id.length > 0);
    if (valid.length === 0) return;
    const now = new Date();
    await prisma.$transaction(
      valid.map((asset) =>
        prisma.asset.upsert({
          where: { adobeAssetId: asset.id },
          update: {
            lastSeenAt: now,
            title: asset.title ?? undefined,
            creatorId: asset.creatorId || undefined,
            creatorName: asset.creatorName ?? undefined,
            thumbnailUrl: asset.thumbnail ?? undefined,
            detailsUrl: asset.assetUrl ?? undefined,
            contentType: asset.contentType,
            width: asset.width ?? undefined,
            height: asset.height ?? undefined,
            keywords: keywordsToJson(asset),
            category: asset.category ?? undefined,
            isTransparent: asset.isTransparent ?? undefined,
            isGenerativeAI: asset.isGenerativeAI ?? undefined,
          },
          create: {
            adobeAssetId: asset.id,
            firstSeenAt: now,
            lastSeenAt: now,
            title: asset.title,
            creatorId: asset.creatorId || null,
            creatorName: asset.creatorName,
            thumbnailUrl: asset.thumbnail,
            detailsUrl: asset.assetUrl,
            contentType: asset.contentType,
            width: asset.width,
            height: asset.height,
            keywords: keywordsToJson(asset),
            category: asset.category,
            isTransparent: asset.isTransparent,
            isGenerativeAI: asset.isGenerativeAI,
          },
        }),
      ),
    );
  }

  async upsertCreator(creator: CreatorUpsert): Promise<void> {
    const prisma = getPrisma();
    if (!prisma) return;
    const now = new Date();
    await prisma.creator.upsert({
      where: { adobeCreatorId: creator.adobeCreatorId },
      update: {
        lastSeenAt: now,
        creatorName: creator.creatorName ?? undefined,
        portfolioUrl: creator.portfolioUrl ?? undefined,
      },
      create: {
        adobeCreatorId: creator.adobeCreatorId,
        creatorName: creator.creatorName ?? null,
        portfolioUrl: creator.portfolioUrl ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
  }

  async recordSearch(query: string, searchType: string): Promise<void> {
    const prisma = getPrisma();
    if (!prisma) return;
    await prisma.searchHistory.create({ data: { query, searchType } });
  }

  async getTrackedCreators(): Promise<Array<{ adobeCreatorId: string; creatorName: string | null }>> {
    const prisma = getPrisma();
    if (!prisma) return [];
    const rows = await prisma.creator.findMany({ select: { adobeCreatorId: true, creatorName: true } });
    return rows;
  }

  async getObservationStats(adobeAssetIds: string[]): Promise<{ assetsWithObservations: number; totalObservations: number }> {
    const prisma = getPrisma();
    if (!prisma) return { assetsWithObservations: 0, totalObservations: 0 };
    const uniqueIds = [...new Set(adobeAssetIds.filter((id) => id.length > 0))];
    if (uniqueIds.length === 0) return { assetsWithObservations: 0, totalObservations: 0 };
    const assets = await prisma.asset.findMany({
      where: { adobeAssetId: { in: uniqueIds } },
      select: { _count: { select: { observations: true } } },
    });
    const totalObservations = assets.reduce((sum, asset) => sum + asset._count.observations, 0);
    const assetsWithObservations = assets.filter((asset) => asset._count.observations > 0).length;
    return { assetsWithObservations, totalObservations };
  }

  async getSummary(): Promise<SummaryStats> {
    const prisma = getPrisma();
    if (!prisma) return { totalAssets: 0, indexedAssets: 0, assetsWithAvailableMetrics: 0, totalObservations: 0 };
    const [totalAssets, totalObservations, observedRows, metricRows] = await Promise.all([
      prisma.asset.count(),
      prisma.assetObservation.count(),
      prisma.assetObservation.findMany({ select: { assetId: true }, distinct: ['assetId'] }),
      prisma.assetObservation.findMany({
        select: { assetId: true },
        distinct: ['assetId'],
        where: {
          OR: [{ availableDownloadMetric: { not: null } }, { popularitySignal: { not: null } }],
        },
      }),
    ]);
    return {
      totalAssets,
      indexedAssets: observedRows.length,
      assetsWithAvailableMetrics: metricRows.length,
      totalObservations,
    };
  }

  async getTopKeywords(limit: number): Promise<CreatorKeywordCount[]> {
    const prisma = getPrisma();
    if (!prisma) return [];
    const assets = await prisma.asset.findMany({
      where: { keywords: { not: Prisma.DbNull } },
      select: { keywords: true },
    });
    return aggregateKeywords(assets.map((a) => a.keywords), limit);
  }

  async getKeywordAnalytics(limit: number): Promise<KeywordAnalytics> {
    const prisma = getPrisma();
    if (!prisma) return { keywords: [], totalAssets: 0, source: 'database' };
    const assets = await prisma.asset.findMany({
      where: { keywords: { not: Prisma.DbNull } },
      select: { keywords: true },
    });
    return {
      keywords: aggregateKeywords(assets.map((a) => a.keywords), limit),
      totalAssets: assets.length,
      source: 'database',
    };
  }

  async getCreatorOverview(adobeCreatorId: string, limit: number): Promise<CreatorOverview | null> {
    const prisma = getPrisma();
    if (!prisma) return null;
    const creator = await prisma.creator.findUnique({
      where: { adobeCreatorId },
      include: { assets: true },
    });
    if (!creator) return null;

    const contentTypeCounts = new Map<string, number>();
    const keywordCounts = new Map<string, number>();
    for (const asset of creator.assets) {
      const type = asset.contentType ?? 'unknown';
      contentTypeCounts.set(type, (contentTypeCounts.get(type) ?? 0) + 1);
      if (Array.isArray(asset.keywords)) {
        for (const kw of asset.keywords) {
          if (typeof kw === 'string') keywordCounts.set(kw, (keywordCounts.get(kw) ?? 0) + 1);
        }
      }
    }

    const observationRows = await prisma.assetObservation.findMany({
      where: { asset: { creatorId: adobeCreatorId } },
      orderBy: { observedAt: 'desc' },
      select: { assetId: true, availableDownloadMetric: true, popularitySignal: true, source: true },
    });
    const latestByAsset = new Map<number, { value: number | null; source: string }>();
    for (const row of observationRows) {
      if (latestByAsset.has(row.assetId)) continue;
      latestByAsset.set(row.assetId, {
        value: row.availableDownloadMetric ?? row.popularitySignal ?? null,
        source: row.source,
      });
    }

    const topAssets: CreatorTopAsset[] = creator.assets
      .map((asset) => {
        const latest = latestByAsset.get(asset.id);
        return {
          adobeAssetId: asset.adobeAssetId,
          title: asset.title,
          thumbnailUrl: asset.thumbnailUrl,
          lastValue: latest?.value ?? null,
          lastValueSource: latest?.source ?? null,
        };
      })
      .sort((a, b) => (b.lastValue ?? -1) - (a.lastValue ?? -1))
      .slice(0, limit);

    return {
      adobeCreatorId: creator.adobeCreatorId,
      creatorName: creator.creatorName,
      portfolioUrl: creator.portfolioUrl,
      firstSeenAt: creator.firstSeenAt.toISOString(),
      lastSeenAt: creator.lastSeenAt.toISOString(),
      totalIndexedAssets: creator.assets.length,
      contentTypes: [...contentTypeCounts.entries()]
        .map(([contentType, count]) => ({ contentType, count }))
        .sort((a, b) => b.count - a.count),
      topAssets,
      topKeywords: keywordListSorted(keywordCounts, limit),
    };
  }
}

/** Count keyword occurrences across a set of JSON keyword arrays. */
function aggregateKeywords(keywordArrays: Array<unknown>, limit: number): CreatorKeywordCount[] {
  const counts = new Map<string, number>();
  for (const kws of keywordArrays) {
    if (!Array.isArray(kws)) continue;
    for (const kw of kws) {
      if (typeof kw !== 'string') continue;
      counts.set(kw, (counts.get(kw) ?? 0) + 1);
    }
  }
  return keywordListSorted(counts, limit);
}

function keywordListSorted(counts: Map<string, number>, limit: number): CreatorKeywordCount[] {
  return [...counts.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
    .slice(0, limit);
}

/**
 * Session-only in-memory history store.
 *
 * Used when DATABASE_URL is not configured so the historical UI still works
 * during a single server run. It is explicitly labeled as non-persistent;
 * observations are lost on restart.
 */
export class MemoryHistoryStore implements HistoryStore {
  readonly available = false;
  readonly label = 'Session-only (in-memory) — configure DATABASE_URL to persist';

  private observations = new Map<string, ObservationPoint[]>();
  private tracking = new Map<string, AssetTracking>();
  private creators = new Map<string, { adobeCreatorId: string; creatorName: string | null }>();
  private assets = new Map<
    string,
    {
      adobeAssetId: string;
      title: string | null;
      thumbnailUrl: string | null;
      contentType: string | null;
      keywords: string[];
      creatorId: string | null;
    }
  >();
  private searches: Array<{ query: string; searchType: string; createdAt: Date }> = [];

  private recordAssetMeta(asset: { keywords?: AdobeStockAsset['keywords'] } & Partial<AdobeStockAsset>): void {
    if (!asset.id) return;
    const existing = this.assets.get(asset.id);
    this.assets.set(asset.id, {
      adobeAssetId: asset.id,
      title: asset.title ?? existing?.title ?? null,
      thumbnailUrl: asset.thumbnail ?? existing?.thumbnailUrl ?? null,
      contentType: asset.contentType ?? existing?.contentType ?? null,
      keywords: Array.isArray(asset.keywords) ? asset.keywords : (existing?.keywords ?? []),
      creatorId: asset.creatorId || existing?.creatorId || null,
    });
  }

  async saveObservation(input: SaveObservationInput): Promise<void> {
    const observedAt = (input.observedAt ?? new Date()).toISOString();
    const points = this.observations.get(input.adobeAssetId) ?? [];
    points.push({
      observedAt,
      value: input.availableDownloadMetric ?? input.popularitySignal ?? null,
      source: input.source,
    });
    this.observations.set(input.adobeAssetId, points);

    const existing = this.tracking.get(input.adobeAssetId) ?? {
      adobeAssetId: input.adobeAssetId,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      observationCount: 0,
    };
    existing.lastSeenAt = observedAt;
    existing.observationCount += 1;
    if (!existing.firstSeenAt) existing.firstSeenAt = observedAt;
    this.tracking.set(input.adobeAssetId, existing);

    if (input.asset) {
      this.recordAssetMeta({ id: input.adobeAssetId, ...input.asset });
    }
    if (input.asset?.creatorId) {
      await this.upsertCreator({
        adobeCreatorId: input.asset.creatorId,
        creatorName: input.asset.creatorName ?? null,
        portfolioUrl: `${PORTFOLIO_BASE}/${input.asset.creatorId}`,
      });
    }
  }

  async getAssetObservations(adobeAssetId: string, since: Date | null): Promise<ObservationPoint[]> {
    const points = this.observations.get(adobeAssetId) ?? [];
    if (!since) return points;
    const cutoff = since.getTime();
    return points.filter((p) => new Date(p.observedAt).getTime() >= cutoff);
  }

  async getRecentObservationKeys(assetIds: string[], since: Date): Promise<Set<string>> {
    const cutoff = since.getTime();
    const result = new Set<string>();
    for (const id of assetIds) {
      const points = this.observations.get(id) ?? [];
      if (points.some((p) => new Date(p.observedAt).getTime() >= cutoff)) result.add(id);
    }
    return result;
  }

  async getAssetTracking(adobeAssetId: string): Promise<AssetTracking | null> {
    return this.tracking.get(adobeAssetId) ?? null;
  }

  async getTrackingBatch(adobeAssetIds: string[]): Promise<Record<string, AssetTracking>> {
    const result: Record<string, AssetTracking> = {};
    for (const id of adobeAssetIds) {
      const tracking = this.tracking.get(id);
      if (tracking) result[id] = tracking;
    }
    return result;
  }

  async upsertAsset(asset: AdobeStockAsset): Promise<void> {
    await this.upsertAssets([asset]);
  }

  async upsertAssets(assets: AdobeStockAsset[]): Promise<void> {
    const now = new Date().toISOString();
    for (const asset of assets) {
      if (!asset.id) continue;
      this.recordAssetMeta(asset);
      const existing = this.tracking.get(asset.id);
      if (existing) {
        existing.lastSeenAt = now;
        this.tracking.set(asset.id, existing);
      } else {
        this.tracking.set(asset.id, {
          adobeAssetId: asset.id,
          firstSeenAt: now,
          lastSeenAt: now,
          observationCount: 0,
        });
      }
      if (asset.creatorId) {
        await this.upsertCreator({
          adobeCreatorId: asset.creatorId,
          creatorName: asset.creatorName ?? null,
          portfolioUrl: `${PORTFOLIO_BASE}/${asset.creatorId}`,
        });
      }
    }
  }

  async upsertCreator(creator: CreatorUpsert): Promise<void> {
    this.creators.set(creator.adobeCreatorId, {
      adobeCreatorId: creator.adobeCreatorId,
      creatorName: creator.creatorName ?? null,
    });
  }

  async recordSearch(query: string, searchType: string): Promise<void> {
    this.searches.push({ query, searchType, createdAt: new Date() });
  }

  async getTrackedCreators(): Promise<Array<{ adobeCreatorId: string; creatorName: string | null }>> {
    return [...this.creators.values()];
  }

  async getObservationStats(adobeAssetIds: string[]): Promise<{ assetsWithObservations: number; totalObservations: number }> {
    let totalObservations = 0;
    let assetsWithObservations = 0;
    for (const id of adobeAssetIds) {
      const count = this.observations.get(id)?.length ?? 0;
      totalObservations += count;
      if (count > 0) assetsWithObservations += 1;
    }
    return { assetsWithObservations, totalObservations };
  }

  async getSummary(): Promise<SummaryStats> {
    let totalObservations = 0;
    let assetsWithAvailableMetrics = 0;
    for (const [assetId, points] of this.observations) {
      totalObservations += points.length;
      if (points.some((p) => p.value !== null)) assetsWithAvailableMetrics += 1;
    }
    return {
      totalAssets: this.assets.size,
      indexedAssets: this.observations.size,
      assetsWithAvailableMetrics,
      totalObservations,
    };
  }

  async getTopKeywords(limit: number): Promise<CreatorKeywordCount[]> {
    return aggregateKeywords([...this.assets.values()].map((a) => a.keywords), limit);
  }

  async getKeywordAnalytics(limit: number): Promise<KeywordAnalytics> {
    return {
      keywords: await this.getTopKeywords(limit),
      totalAssets: this.assets.size,
      source: 'session',
    };
  }

  async getCreatorOverview(adobeCreatorId: string, limit: number): Promise<CreatorOverview | null> {
    const creator = this.creators.get(adobeCreatorId);
    if (!creator) return null;

    const creatorAssets = [...this.assets.values()].filter((a) => a.creatorId === adobeCreatorId);
    const contentTypeCounts = new Map<string, number>();
    const keywordCounts = new Map<string, number>();
    for (const asset of creatorAssets) {
      const type = asset.contentType ?? 'unknown';
      contentTypeCounts.set(type, (contentTypeCounts.get(type) ?? 0) + 1);
      for (const kw of asset.keywords) keywordCounts.set(kw, (keywordCounts.get(kw) ?? 0) + 1);
    }

    let firstSeenAt: string | null = null;
    let lastSeenAt: string | null = null;
    for (const id of creatorAssets.map((a) => a.adobeAssetId)) {
      const tracking = this.tracking.get(id);
      if (!tracking) continue;
      if (!firstSeenAt || (tracking.firstSeenAt ?? '') < firstSeenAt) firstSeenAt = tracking.firstSeenAt;
      if (!lastSeenAt || (tracking.lastSeenAt ?? '') > lastSeenAt) lastSeenAt = tracking.lastSeenAt;
    }

    const topAssets: CreatorTopAsset[] = creatorAssets
      .map((asset) => {
        const points = this.observations.get(asset.adobeAssetId) ?? [];
        const latest = points.length > 0 ? points[points.length - 1] : undefined;
        return {
          adobeAssetId: asset.adobeAssetId,
          title: asset.title,
          thumbnailUrl: asset.thumbnailUrl,
          lastValue: latest?.value ?? null,
          lastValueSource: latest?.source ?? null,
        };
      })
      .sort((a, b) => (b.lastValue ?? -1) - (a.lastValue ?? -1))
      .slice(0, limit);

    return {
      adobeCreatorId,
      creatorName: creator.creatorName,
      portfolioUrl: `${PORTFOLIO_BASE}/${adobeCreatorId}`,
      firstSeenAt,
      lastSeenAt,
      totalIndexedAssets: creatorAssets.length,
      contentTypes: [...contentTypeCounts.entries()]
        .map(([contentType, count]) => ({ contentType, count }))
        .sort((a, b) => b.count - a.count),
      topAssets,
      topKeywords: keywordListSorted(keywordCounts, limit),
    };
  }
}

export function isDatabaseConfiguredForHistory(): boolean {
  return isDatabaseConfigured();
}
