import { Router } from 'express';
import { config } from '../config';
import { TtlCache } from '../lib/cache';
import { parsePositiveInt, validators, validateCreatorId } from '../lib/validation';
import { createDataProvider } from '../services/adobeStock';
import { getCreatorStats } from '../services/adobeStock';
import { getHistoryProvider } from '../services/history/historicalDataProvider';
import { recordAssetsObservation, trackCreator } from '../services/history/recorder';

const router = Router();
const provider = createDataProvider();
const history = getHistoryProvider();
const statsCache = new TtlCache<unknown>(config.cache.ttlMs);

/**
 * GET /api/creator/:creatorId/assets
 * Query params: filter, sort, contentType, page, limit
 * Successful API results are indexed locally (assets + creator) and point-in-
 * time observations are recorded (throttled) for the historical analytics.
 */
router.get('/creator/:creatorId/assets', async (req, res, next) => {
  try {
    const creatorId = validateCreatorId(req.params.creatorId);
    const filter = validators.filter(req.query.filter as string | undefined);
    const sort = validators.sort(req.query.sort as string | undefined);
    const contentType = validators.contentType(req.query.contentType as string | undefined);
    const page = validators.page(req.query.page as string | undefined);
    const limit = validators.limit(req.query.limit as string | undefined);

    await history.recordSearch(creatorId, 'creator');

    const result = await provider.fetchCreatorAssets({ creatorId, filter, sort, contentType, page, limit });
    if (result.source === 'ok' && result.assets.length > 0) {
      await trackCreator(history, creatorId, result.assets[0]?.creatorName);
      await history.trackAssets(result.assets);
      await recordAssetsObservation(history, provider, result.assets);
      result.assets = await history.enrichWithTracking(result.assets);
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/creator/:creatorId/stats
 * Aggregated totals for the creator (from the configured data source).
 */
router.get('/creator/:creatorId/stats', async (req, res, next) => {
  try {
    const creatorId = validateCreatorId(req.params.creatorId);
    const cached = statsCache.get(creatorId);
    if (cached !== undefined) {
      res.json(cached);
      return;
    }
    const stats = await getCreatorStats(provider, creatorId);
    statsCache.set(creatorId, stats);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/creator/:creatorId/links
 * Generated stock.adobe.com search URLs for the creator (Downloaded,
 * Undownloaded, Recent, PNG, Vector). Requires no credentials and never
 * fetches from Adobe — the links are opened in the user's browser.
 */
router.get('/creator/:creatorId/links', (req, res, next) => {
  try {
    const creatorId = validateCreatorId(req.params.creatorId);
    const links = provider.buildCreatorSearchLinks(creatorId);
    res.json({ ...links, mode: provider.mode, provider: provider.name });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/creator/:creatorId/availability
 * Honest per-field availability for the creator dashboard: whether the
 * official API is connected and which categories of data (downloads,
 * acceptance, uploads, sales) it can or cannot provide. Never guesses.
 */
router.get('/creator/:creatorId/availability', async (req, res, next) => {
  try {
    const creatorId = validateCreatorId(req.params.creatorId);
    res.json({
      creatorId,
      provider: provider.name,
      mode: provider.mode,
      availability: provider.getCreatorAvailability(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/creator/:creatorId/overview?limit=50
 * Creator dashboard: name, portfolio link, indexed assets, content-type
 * breakdown, top assets, top keywords, first/last seen. Derived from the
 * local history index; null when the creator has not been searched yet.
 */
router.get('/creator/:creatorId/overview', async (req, res, next) => {
  try {
    const creatorId = validateCreatorId(req.params.creatorId);
    const limit = parsePositiveInt(req.query.limit as string | undefined, 'limit', 50, 1000);
    const overview = await history.getCreatorOverview(creatorId, limit);
    res.json({
      creatorId,
      overview,
      availability: provider.getCreatorAvailability(),
      historyAvailable: history.available,
      storeLabel: history.storeLabel,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
