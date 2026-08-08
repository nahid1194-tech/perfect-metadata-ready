import { Router } from 'express';
import { parsePositiveInt } from '../lib/validation';
import { createDataProvider } from '../services/adobeStock';
import { getHistoryProvider } from '../services/history/historicalDataProvider';

const router = Router();
const provider = createDataProvider();
const history = getHistoryProvider();

/**
 * GET /api/analytics/summary
 * Dashboard summary cards derived from the local index: Total Assets,
 * Indexed Assets, Assets With Available Metrics, Total Historical
 * Observations. Honest labels tell the UI where each number comes from.
 */
router.get('/analytics/summary', async (_req, res, next) => {
  try {
    const stats = await history.getSummary();
    res.json({
      ...stats,
      historyAvailable: history.available,
      storeLabel: history.storeLabel,
      providerMode: provider.mode,
      provider: provider.name,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/analytics/keywords?limit=50
 * Most-used keywords across all locally indexed assets.
 */
router.get('/analytics/keywords', async (req, res, next) => {
  try {
    const limit = parsePositiveInt(req.query.limit as string | undefined, 'limit', 50, 1000);
    const result = await history.getKeywordAnalytics(limit);
    res.json({ ...result, historyAvailable: history.available, storeLabel: history.storeLabel });
  } catch (error) {
    next(error);
  }
});

export default router;
