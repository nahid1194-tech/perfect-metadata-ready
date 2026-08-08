import { config } from '../config';
import { createDataProvider } from './adobeStock/dataProvider';
import { getHistoryProvider } from './history/historicalDataProvider';
import { recordAssetsObservation, trackCreator } from './history/recorder';

export interface ObservationSyncResult {
  sampledCreators: number;
  recordedObservations: number;
}

/**
 * Periodic background job: re-sample tracked creators from the official
 * Adobe Stock API and append point-in-time observations to the history store.
 *
 * Runs only against the API provider; in search-link mode (no credentials)
 * the provider reports "unavailable" and nothing is recorded. Concurrency and
 * backoff are handled by the API client's own polite queue, so this never
 * hammers Adobe or bypasses rate limits.
 */
export async function runObservationSync(): Promise<ObservationSyncResult> {
  const history = getHistoryProvider();
  const provider = createDataProvider();
  const creators = await history.getTrackedCreators();
  if (creators.length === 0) {
    return { sampledCreators: 0, recordedObservations: 0 };
  }

  let sampledCreators = 0;
  let recordedObservations = 0;

  const limited = creators.slice(0, config.scheduler.perCreatorLimit);
  for (const creator of limited) {
    const result = await provider.fetchCreatorAssets({
      creatorId: creator.adobeCreatorId,
      filter: 'all',
      sort: 'downloads-desc',
      contentType: 'all',
      page: 1,
      limit: config.adobeApi.limit,
    });
    if (result.source !== 'ok' || result.assets.length === 0) continue;

    sampledCreators += 1;
    await history.trackAssets(result.assets);
    const { recorded } = await recordAssetsObservation(history, provider, result.assets);
    recordedObservations += recorded;
  }

  return { sampledCreators, recordedObservations };
}

/** Start the periodic sync. The timer is unref'd so it never blocks shutdown. */
export function startObservationScheduler(): void {
  if (!config.scheduler.enabled) return;

  const run = async (): Promise<void> => {
    try {
      const result = await runObservationSync();
      if (result.sampledCreators > 0 || result.recordedObservations > 0) {
        console.log(
          `[scheduler] synced ${result.sampledCreators} creator(s), recorded ${result.recordedObservations} observation(s).`,
        );
      }
    } catch (error) {
      console.error('[scheduler] observation sync failed:', error instanceof Error ? error.message : error);
    }
  };

  // Kick off once shortly after boot, then on the configured interval.
  const firstRun = setTimeout(() => {
    void run();
  }, config.scheduler.startDelayMs);
  firstRun.unref?.();

  const timer = setInterval(() => {
    void run();
  }, config.scheduler.intervalMs);
  timer.unref?.();
}
