import rateLimit from 'express-rate-limit';
import { config } from '../config';

/**
 * Basic in-memory rate limiting for the API. Prevents accidental abuse of the
 * backend (which in turn talks to Adobe Stock).
 */
export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down and try again shortly.',
    },
  },
});
