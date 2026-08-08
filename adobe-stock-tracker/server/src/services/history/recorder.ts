import { config } from '../../config';
import type { AdobeStockDataProvider } from '../adobeStock/dataProvider';
import type { AdobeStockAsset } from '../adobeStock/adobeStockTypes';
import type { HistoricalDataProvider } from './historicalDataProvider';
import type { SaveObservationInput } from './types';

export interface RecordObservationResult {
  recorded: number;
  skipped: number;
}

/**
 * Turn a batch of fetched assets into point-in-time observations.
 *
 * Honest metric mapping:
 *  - When the provider genuinely exposes download counts, the exact count is
 *    recorded with source "official-api-exact".
 *  - Otherwise the provider's clearly-labeled popularity signal (derived from
 *    Adobe's ranking order) is recorded with source "popularity-signal".
 * A popularity signal is NEVER stored in the exact-count column, so it can
 * never be mistaken for a real download count later.
 */
export async function recordAssetsObservation(
  history: HistoricalDataProvider,
  provider: AdobeStockDataProvider,
  assets: AdobeStockAsset[],
): Promise<RecordObservationResult> {
  const usesExactCounts = provider.capabilities?.exposesDownloadCounts === true;
  const inputs: SaveObservationInput[] = assets
    .filter((asset) => asset.id.length > 0)
    .map((asset) => ({
      adobeAssetId: asset.id,
      observedAt: new Date(),
      source: usesExactCounts ? 'official-api-exact' : 'popularity-signal',
      availableDownloadMetric: usesExactCounts ? asset.downloads : null,
      popularitySignal: usesExactCounts ? null : (asset.popularity?.percentile ?? null),
      asset: {
        title: asset.title,
        creatorId: asset.creatorId,
        creatorName: asset.creatorName,
        thumbnail: asset.thumbnail,
        assetUrl: asset.assetUrl,
        contentType: asset.contentType,
        width: asset.width,
        height: asset.height,
        keywords: asset.keywords,
        category: asset.category,
        isTransparent: asset.isTransparent,
        isGenerativeAI: asset.isGenerativeAI,
      },
    }));

  return history.recordObservationBatch(inputs, config.scheduler.intervalMs);
}

/** Upsert a fetched creator into the local index (idempotent). */
export async function trackCreator(
  history: HistoricalDataProvider,
  creatorId: string,
  creatorName?: string | null,
): Promise<void> {
  await history.trackCreator({
    adobeCreatorId: creatorId,
    creatorName: creatorName ?? null,
    portfolioUrl: `https://stock.adobe.com/contributor/${creatorId}`,
  });
}
