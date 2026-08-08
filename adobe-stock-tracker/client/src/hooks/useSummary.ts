import { useCallback, useEffect, useState } from 'react';

import { fetchSummary } from '@/lib/api';
import type { ApiError, SummaryResponse } from '@/types';

type Phase = 'loading' | 'loaded' | 'error';

/**
 * Dashboard summary cards (Total Assets, Indexed Assets, Assets With
 * Available Metrics, Total Historical Observations). Fetched once on mount;
 * refresh() re-reads the server-side local index.
 */
export function useSummary() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setPhase('loading');
    setError(null);

    fetchSummary(controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setSummary(res);
        setPhase('loaded');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err as ApiError);
        setPhase('error');
      });

    return () => controller.abort();
  }, [refreshNonce]);

  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  return { summary, phase, error, refresh };
}
