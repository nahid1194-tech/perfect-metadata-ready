import { Router } from 'express';
import { validators, validateAssetId } from '../lib/validation';
import { createDataProvider } from '../services/adobeStock';
import { getHistoryProvider } from '../services/history/historicalDataProvider';
import { recordAssetsObservation } from '../services/history/recorder';

const router = Router();
const provider = createDataProvider();
const history = getHistoryProvider();

/**
 * GET /api/assets/:assetId
 * Metadata for a single asset (Asset ID search mode). Includes the generated
 * stock.adobe.com link plus any local tracking (first/last seen).
 */
router.get('/assets/:assetId', async (req, res, next) => {
  try {
    const assetId = validateAssetId(req.params.assetId);
    await history.recordSearch(assetId, 'asset-id');

    const metadata = await provider.getAssetMetadata(assetId);
    let asset = metadata.asset;
    if (asset) {
      await history.trackAssets([asset]);
      const tracking = await history.getAssetTracking(assetId);
      if (tracking) {
        asset = {
          ...asset,
          observationCount: tracking.observationCount,
          firstSeenAt: tracking.firstSeenAt,
          lastSeenAt: tracking.lastSeenAt,
        };
      }
      if (asset.popularity && provider.mode === 'api') {
        await recordAssetsObservation(history, provider, [asset]);
      }
    }

    res.json({
      ...metadata,
      asset,
      tracking: await history.getAssetTracking(assetId),
      historyAvailable: history.available,
      storeLabel: history.storeLabel,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/assets/:assetId/history?range=7d|30d|90d|all
 * Historical observations (current/previous/change) for one asset.
 */
router.get('/assets/:assetId/history', async (req, res, next) => {
  try {
    const assetId = validateAssetId(req.params.assetId);
    const range = validators.historyRange(req.query.range as string | undefined);
    const result = await history.getHistory(assetId, range);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/assets/:assetId/links
 * Generated stock.adobe.com URL for an Asset ID (link mode; never fetched).
 */
router.get('/assets/:assetId/links', (req, res, next) => {
  try {
    const assetId = validateAssetId(req.params.assetId);
    res.json({
      assetId,
      link: provider.buildAssetIdSearchLink(assetId),
      mode: provider.mode,
      provider: provider.name,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
