import { Router } from 'express';
import { validators, validateSearchQuery } from '../lib/validation';
import { createDataProvider } from '../services/adobeStock';
import { getHistoryProvider } from '../services/history/historicalDataProvider';
import { recordAssetsObservation } from '../services/history/recorder';

const router = Router();
const provider = createDataProvider();
const history = getHistoryProvider();

/**
 * GET /api/search/links?q=...
 * Generated stock.adobe.com keyword-search URLs for an Asset/Title query.
 * Requires no credentials and never fetches from Adobe.
 */
router.get('/search/links', (req, res, next) => {
  try {
    const query = validateSearchQuery(req.query.q as string | undefined);
    const links = provider.buildAssetSearchLinks(query);
    res.json({ ...links, mode: provider.mode, provider: provider.name });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/search/assets?q=...&filter=&sort=&page=&limit=
 * Keyword (Asset/Title) search over the Adobe Stock catalog.
 * Successful API results are indexed locally and recorded as observations.
 */
router.get('/search/assets', async (req, res, next) => {
  try {
    const query = validateSearchQuery(req.query.q as string | undefined);
    const filter = validators.assetFilter(req.query.filter as string | undefined);
    const sort = validators.assetSort(req.query.sort as string | undefined);
    const page = validators.page(req.query.page as string | undefined);
    const limit = validators.limit(req.query.limit as string | undefined);

    await history.recordSearch(query, 'search');

    const result = await provider.searchAssets({ query, filter, sort, page, limit });
    if (result.source === 'ok' && result.assets.length > 0) {
      await history.trackAssets(result.assets);
      await recordAssetsObservation(history, provider, result.assets);
      result.assets = await history.enrichWithTracking(result.assets);
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
