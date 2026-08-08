import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchCreatorAvailability } from '@/lib/api';
import type { ApiError, CreatorAvailabilityResponse } from '@/types';

type Phase = 'idle' | 'loading' | 'loaded';

/** Loads the honest per-field availability report for a creator. */
export function useCreatorAvailability(creatorId: string | null) {
  const [result, setResult] = useState<CreatorAvailabilityResponse | null>(null);
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

    fetchCreatorAvailability(creatorId, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setResult(res);
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

  return { result, phase, error, refresh };
}
