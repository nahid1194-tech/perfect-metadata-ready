import { Router } from 'express';

import { config } from '../config';
import { createDataProvider } from '../services/adobeStock';
import {
  buildAdobeStockApiHeaders,
  buildAdobeStockApiSearchUrl,
  fetchAdobeStockSearch,
  type AdobeStockApiRequestOptions,
} from '../services/adobeStock/adobeStockApiClient';
import { getHistoryProvider } from '../services/history/historicalDataProvider';

const router = Router();
const provider = createDataProvider();
const history = getHistoryProvider();

/**
 * GET /api/settings
 *
 * Public, read-only configuration/status for the Settings page. Never
 * includes the API key, access token, or any other credential — the key only
 * ever lives in server/.env on this machine.
 */
router.get('/settings', (_req, res) => {
  const apiKeyConfigured = Boolean(config.adobeApi.clientId);
  res.json({
    provider: provider.name,
    providerMode: provider.mode,
    apiKeyConfigured,
    apiStatus: apiKeyConfigured ? 'configured' : 'not_configured',
    product: config.adobeApi.product,
    locale: config.adobeApi.locale,
    apiBaseUrl: config.adobeApi.baseUrl,
    siteSearchBaseUrl: config.adobeSite.searchBaseUrl,
    licenseHistory: {
      authorized: Boolean(config.adobeApi.accessToken),
    },
    database: {
      enabled: config.database.enabled,
      label: history.storeLabel,
    },
    environment: {
      nodeEnv: process.env.NODE_ENV ?? 'development',
      port: config.port,
      rateLimitMax: config.rateLimit.max,
      rateLimitWindowMs: config.rateLimit.windowMs,
      cacheTtlMs: config.cache.ttlMs,
      observationSchedulerEnabled: config.scheduler.enabled,
    },
  });
});

/**
 * POST /api/settings/test-connection
 *
 * Performs one small, real request against the official Adobe Stock API and
 * reports whether the configured credentials actually work. Uses a
 * single-result creator probe (creatorId=1, limit=1) with no retries so the
 * check is fast and polite. The response never contains the API key.
 */
router.post('/settings/test-connection', async (_req, res, next) => {
  try {
    if (!config.adobeApi.clientId) {
      res.json({
        status: 'not_configured',
        message:
          'Adobe Stock API key is not configured. Set ADOBE_STOCK_API_KEY in server/.env, then restart the server.',
      });
      return;
    }

    const options: AdobeStockApiRequestOptions = {
      baseUrl: config.adobeApi.baseUrl,
      licenseHistoryBaseUrl: config.adobeApi.licenseHistoryBaseUrl,
      locale: config.adobeApi.locale,
      timeoutMs: config.adobeApi.requestTimeoutMs,
      credentials: {
        clientId: config.adobeApi.clientId,
        product: config.adobeApi.product,
        accessToken: config.adobeApi.accessToken,
      },
    };

    const started = Date.now();
    const url = buildAdobeStockApiSearchUrl(options, {
      creatorId: '1',
      filter: 'all',
      sort: 'downloads-desc',
      contentType: 'all',
      page: 1,
      limit: 1,
    });
    const headers = buildAdobeStockApiHeaders(options.credentials);
    const result = await fetchAdobeStockSearch(url, headers, options.timeoutMs, { maxRetries: 0, backoffBaseMs: 0 });
    const latencyMs = Date.now() - started;

    switch (result.status) {
      case 'ok':
        res.json({ status: 'connected', latencyMs, message: 'Connected to the official Adobe Stock API.' });
        return;
      case 'rate_limited':
        res.json({ status: 'rate_limited', latencyMs, message: result.message });
        return;
      case 'blocked':
        res.json({ status: 'invalid', latencyMs, message: result.message });
        return;
      case 'timeout':
        res.json({ status: 'failed', latencyMs, message: 'The request to the Adobe Stock API timed out.' });
        return;
      default:
        res.json({ status: 'failed', latencyMs, message: result.message ?? 'The Adobe Stock API could not be reached.' });
    }
  } catch (error) {
    next(error);
  }
});

export default router;
