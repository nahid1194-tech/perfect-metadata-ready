import { Router } from 'express';

import type { AdobeStockAsset } from '../services/adobeStock/adobeStockTypes';
import { createDataProvider } from '../services/adobeStock';
import { getHistoryProvider } from '../services/history/historicalDataProvider';
import { recordAssetsObservation, trackCreator } from '../services/history/recorder';
import { validators, validateCreatorId, validateAssetId } from '../lib/validation';
import { TtlCache } from '../lib/cache';
import { config } from '../config';

const router = Router();
const provider = createDataProvider();
const history = getHistoryProvider();

/**
 * Normalize one internal AdobeStockAsset into the documented wire shape
 * (GET /api/adobe/creator/:creatorId). `thumbnailUrl` is the best available
 * direct URL, resolved in Adobe's documented priority order
 * (thumbnail_1000_url → thumbnail_500_url → thumbnail_url) — never
 * constructed manually. Every extra field is passed through untouched so the
 * previews/detail dialogs can show exactly what Adobe provided.
 */
function normalizeAsset(asset: AdobeStockAsset): {
  id: string;
  title: string | null;
  creatorId: string;
  creatorName: string | null;
  thumbnailUrl: string | null;
  thumbnail500Url: string | null;
  thumbnail1000Url: string | null;
  width: number | null;
  height: number | null;
  contentType: string;
  vectorType: string | null;
  keywords: string[] | null;
  description: string | null;
  isTransparent: boolean | null;
  isGentech: boolean | null;
  detailsUrl: string | null;
  [key: string]: unknown;
} {
  return {
    // Pass through every field Adobe provided (duration, framerate,
    // sizeBytes, premiumLevelId, isPremium, category hierarchy, thumbnail
    // tiers, video previews, …) then override the documented wire names below.
    ...asset,
    id: asset.id,
    title: asset.title,
    creatorId: asset.creatorId,
    creatorName: asset.creatorName,
    thumbnailUrl: asset.thumbnail,
    thumbnail500Url: asset.thumbnail500,
    thumbnail1000Url: asset.thumbnail1000,
    width: asset.width,
    height: asset.height,
    contentType: asset.contentType,
    vectorType: asset.vectorType,
    keywords: asset.keywords,
    description: asset.description,
    isTransparent: asset.isTransparent,
    isGentech: asset.isGenerativeAI,
    detailsUrl: asset.assetUrl,
  };
}

/**
 * Cache identical upstream searches in memory so repeated queries (e.g.
 * switching back to the same tab) never hit Adobe twice within the TTL.
 * Cache key = search type + full query (creator id, filter, sort, content
 * type, page). Historical tracking still runs per request on top of the
 * cached data, so first/last-seen stays fresh.
 */
const creatorSearchCache = new TtlCache<Awaited<ReturnType<typeof provider.fetchCreatorAssets>>>(config.cache.ttlMs);
const similarSearchCache = new TtlCache<Awaited<ReturnType<typeof provider.searchSimilar>>>(config.cache.ttlMs);

/**
 * GET /api/adobe/search?creatorId=...&filter=&sort=&contentType=&page=&limit=
 *
 * Primary Creator ID search endpoint used by the frontend.
 *
 * Backend flow: validate numeric creatorId → build the Search/Files request
 * (creator_id, limit, offset) with x-api-key / x-product → call Adobe →
 * parse JSON → normalize → return the standard CreatorAssetsResponse JSON to
 * the frontend. The API key never leaves this server.
 *
 * Successful API results are also indexed locally (assets + creator) and
 * point-in-time observations are recorded (throttled) for the historical
 * analytics.
 */
router.get('/adobe/search', async (req, res, next) => {
  try {
    const creatorId = validateCreatorId(req.query.creatorId as string | undefined);
    const filter = validators.filter(req.query.filter as string | undefined);
    const sort = validators.sort(req.query.sort as string | undefined);
    const contentType = validators.contentType(req.query.contentType as string | undefined);
    const page = validators.page(req.query.page as string | undefined);
    const limit = validators.limit(req.query.limit as string | undefined);

    await history.recordSearch(creatorId, 'creator');

    const cacheKey = JSON.stringify({ kind: 'creator', creatorId, filter, sort, contentType, page, limit });
    const cached = await creatorSearchCache.memoize(cacheKey, config.cache.ttlMs, () =>
      provider.fetchCreatorAssets({ creatorId, filter, sort, contentType, page, limit }),
    );
    // Clone so enrichment/tracking never mutates the cached entry.
    const result = { ...cached, assets: [...cached.assets] };
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
 * GET /api/adobe/similar?assetId=...&filter=&sort=&page=&limit=
 *
 * Find assets visually similar to a given asset ID using Adobe's documented
 * `search_parameters[similar]`. Same response shape as the keyword search.
 */
router.get('/adobe/similar', async (req, res, next) => {
  try {
    const assetId = validateAssetId(req.query.assetId as string | undefined);
    const filter = validators.assetFilter(req.query.filter as string | undefined);
    const sort = validators.assetSort(req.query.sort as string | undefined);
    const page = validators.page(req.query.page as string | undefined);
    const limit = validators.limit(req.query.limit as string | undefined);

    await history.recordSearch(assetId, 'similar');

    const cacheKey = JSON.stringify({ kind: 'similar', assetId, filter, sort, page, limit });
    const cached = await similarSearchCache.memoize(cacheKey, config.cache.ttlMs, () =>
      provider.searchSimilar(assetId, { query: String(assetId), filter, sort, page, limit }),
    );
    // Clone so enrichment/tracking never mutates the cached entry.
    const result = { ...cached, assets: [...cached.assets] };
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

/**
 * GET /api/adobe/creator/:creatorId
 *
 * Official Adobe Stock Search API lookup for one contributor, normalized into
 * the documented response shape. `success` is false only when the API could
 * not be reached or rejected the request; an empty but successful search
 * returns success:true with total 0.
 *
 * Backend flow: validate numeric creatorId → build the Search/Files request
 * (creator_id, limit, offset) with x-api-key / x-product → call Adobe →
 * parse JSON → normalize → return to the frontend. The API key never leaves
 * this server.
 */
router.get('/adobe/creator/:creatorId', async (req, res, next) => {
  try {
    const creatorId = validateCreatorId(req.params.creatorId);
    const limit = 100;
    const page = 1;

    await history.recordSearch(creatorId, 'creator');

    const result = await provider.fetchCreatorAssets({
      creatorId,
      filter: 'all',
      sort: 'downloads-desc',
      contentType: 'all',
      page,
      limit,
    });

    let assets = result.assets;
    if (result.source === 'ok' && assets.length > 0) {
      await trackCreator(history, creatorId, assets[0]?.creatorName);
      await history.trackAssets(assets);
      await recordAssetsObservation(history, provider, assets);
      assets = await history.enrichWithTracking(assets);
    }

    const success = result.source === 'ok' || result.source === 'empty';
    const normalizedAssets = assets.map(normalizeAsset);

    res.json({
      success,
      source: result.source === 'ok' || result.source === 'empty' ? 'adobe-stock-api' : result.source,
      sourceMessage: result.sourceMessage,
      creator: {
        id: creatorId,
        name: assets[0]?.creatorName ?? null,
      },
      total: result.total ?? 0,
      offset: (page - 1) * limit,
      limit,
      hasMore: result.hasMore,
      assets: normalizedAssets,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
