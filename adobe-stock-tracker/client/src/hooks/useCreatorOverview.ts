import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchCreatorOverview } from '@/lib/api';
import type { ApiError, CreatorOverviewResponse } from '@/types';

type Phase = 'idle' | 'loading' | 'loaded';

/** Creator dashboard data from the local history index (POST-search). */
export function useCreatorOverview(creatorId: string | null) {
  const [overview, setOverview] = useState<CreatorOverviewResponse | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const activeController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!creatorId) return;
    const controller = new AbortController();
    activeController.current = controller;
    setPhase('loading');
    setError(null);

    fetchCreatorOverview(creatorId, 50, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setOverview(res);
        setPhase('loaded');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err as ApiError);
        setPhase('loaded');
      });

    return () => controller.abort();
  }, [creatorId, refreshNonce]);

  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  return { overview, phase, error, refresh };
}
