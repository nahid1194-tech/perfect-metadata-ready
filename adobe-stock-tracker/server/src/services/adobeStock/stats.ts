import { config } from '../../config';
import type { AdobeStockDataProvider } from './dataProvider';
import type { CreatorStatsResult } from './adobeStockTypes';

/**
 * Compute high-level stats for a creator from the configured data provider.
 *
 * Honesty rules:
 *  - totalAssets        = the source's own total for the "all" query.
 *  - undownloadedAssets = the source's own total for the "undiscovered" query
 *                         ONLY when the provider can actually filter to
 *                         undiscovered assets (`canPartitionDiscovered`).
 *                         The official Adobe Stock API treats "undiscovered"
 *                         as an ordering, not a filter, so it stays null there.
 *  - downloadedAssets   = derived as (totalAssets - undownloadedAssets) only
 *                         when both halves are real.
 *  - totalDownloads     = sum of real per-asset download counts across fetched
 *                         assets (bounded by ADOBE_API_MAX_PAGES). Null when
 *                         the source does not expose counts.
 *
 * Every field stays null when the source cannot provide the underlying number.
 */
export async function getCreatorStats(provider: AdobeStockDataProvider, creatorId: string): Promise<CreatorStatsResult> {
  const base = {
    creatorId,
    sort: 'downloads-desc' as const,
    contentType: 'all' as const,
    limit: config.adobeApi.limit,
  };

  const allResult = await provider.fetchCreatorAssets({ ...base, filter: 'all', page: 1 });

  let undownloadedAssets: number | null = null;
  if (provider.capabilities?.canPartitionDiscovered) {
    const undiscoveredResult = await provider.fetchCreatorAssets({ ...base, filter: 'undiscovered', page: 1 });
    undownloadedAssets = undiscoveredResult.total;
  }

  const totalAssets = allResult.total;

  let downloadedAssets: number | null = null;
  if (provider.capabilities?.canPartitionDiscovered && totalAssets !== null && undownloadedAssets !== null) {
    downloadedAssets = Math.max(totalAssets - undownloadedAssets, 0);
  }

  let totalDownloads: number | null = null;
  let totalDownloadsIsPartial = false;
  const countsAvailable =
    provider.capabilities?.exposesDownloadCounts !== false &&
    allResult.assets.some((asset) => asset.downloads !== null && asset.downloads > 0);
  if (countsAvailable && totalAssets !== null) {
    let sum = 0;
    let page = 1;
    while (page <= config.adobeApi.maxPages) {
      const result = await provider.fetchCreatorAssets({ ...base, filter: 'all', page });
      for (const asset of result.assets) {
        if (asset.downloads !== null) sum += asset.downloads;
      }
      if (result.assets.length < config.adobeApi.limit || page * config.adobeApi.limit >= totalAssets) break;
      page += 1;
    }
    totalDownloads = sum;
    totalDownloadsIsPartial = page * config.adobeApi.limit < totalAssets;
  }

  return {
    creatorId,
    totalAssets,
    downloadedAssets,
    undownloadedAssets,
    totalDownloads,
    totalDownloadsIsPartial,
    source: allResult.source,
    sourceMessage: allResult.sourceMessage,
    notice: allResult.notice,
    provider: allResult.provider,
  };
}
