import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchAssetHistory } from '@/lib/api';
import type { ApiError, AssetHistoryResult, HistoryRange } from '@/types';

type Phase = 'idle' | 'loading' | 'loaded';

/** Historical observations + change summary for one asset (History panel). */
export function useHistory(assetId: string | null) {
  const [range, setRange] = useState<HistoryRange>('30d');
  const [history, setHistory] = useState<AssetHistoryResult | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const activeController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!assetId) return;
    const controller = new AbortController();
    activeController.current = controller;
    setPhase('loading');
    setError(null);

    fetchAssetHistory(assetId, range, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setHistory(res);
        setPhase('loaded');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err as ApiError);
        setPhase('loaded');
      });

    return () => controller.abort();
  }, [assetId, range, refreshNonce]);

  const changeRange = useCallback((value: HistoryRange) => setRange(value), []);
  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  return { range, changeRange, history, phase, error, refresh };
}
