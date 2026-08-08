import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import analyticsRouter from './routes/analytics';
import assetRouter from './routes/assets';
import creatorRouter from './routes/creator';
import licenseHistoryRouter from './routes/licenseHistory';
import searchRouter from './routes/search';
import { apiRateLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/error';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.use('/api', apiRateLimiter);
  app.use('/api', creatorRouter);
  app.use('/api', searchRouter);
  app.use('/api', assetRouter);
  app.use('/api', analyticsRouter);
  app.use('/api', licenseHistoryRouter);

  // Serve the built client in production (npm run build && npm start).
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
