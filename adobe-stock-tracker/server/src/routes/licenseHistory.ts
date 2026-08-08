import { Router } from 'express';
import { validators, validateOptionalIsoDate, validateOptionalSearchQuery } from '../lib/validation';
import { createDataProvider } from '../services/adobeStock';

const router = Router();
const provider = createDataProvider();

/**
 * GET /api/license-history?query=&from=&to=&page=&limit=
 *
 * The authenticated account's own license history, from the official Adobe
 * License History API. This is the authenticated customer's licensing history
 * ONLY — it is never interpreted as another contributor's download history.
 *
 * Adobe's License History API cannot filter by free text or date server-side,
 * so this app scans the first N pages (bounded by ADOBE_LICENSE_HISTORY_MAX_PAGES)
 * and applies query/date filters locally. `truncated` is set when the total
 * licensed-asset count exceeds what was scanned.
 */
router.get('/license-history', async (req, res, next) => {
  try {
    const query = validateOptionalSearchQuery(req.query.query as string | undefined);
    const from = validateOptionalIsoDate(req.query.from as string | undefined, 'from');
    const to = validateOptionalIsoDate(req.query.to as string | undefined, 'to');
    const page = validators.page(req.query.page as string | undefined);
    const limit = validators.limit(req.query.limit as string | undefined);

    const result = await provider.getLicenseHistory({ query, from, to, page, limit });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
