import { createApp } from './app';
import { config } from './config';
import { startObservationScheduler } from './services/scheduler';

const app = createApp();

app.listen(config.port, () => {
  console.log(`[adobe-stock-tracker] API listening on http://localhost:${config.port}`);
  console.log(`[adobe-stock-tracker] Data provider: "${config.dataProvider}"`);
  console.log(
    `[adobe-stock-tracker] History: ${config.database.enabled ? 'PostgreSQL (persistent)' : 'session-only (in-memory)'}`,
  );
  startObservationScheduler();
});
