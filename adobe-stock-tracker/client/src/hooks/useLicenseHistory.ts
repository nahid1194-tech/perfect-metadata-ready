import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchLicenseHistory } from '@/lib/api';
import type { ApiError, LicenseHistoryResponse } from '@/types';

type Phase = 'idle' | 'loading' | 'loaded';

const DEFAULT_PAGE_SIZE = 25;

/**
 * "My License History": the authenticated account's own licensing history
 * from the official Adobe License History API. Search/date filters are
 * submitted explicitly (Apply), then applied server-side over the scanned
 * history, with client-side pagination.
 */
export function useLicenseHistory() {
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // "Submitted" snapshots — the effect only re-fetches when these change.
  const [submitted, setSubmitted] = useState<{ query?: string; from?: string; to?: string }>({});

  const [result, setResult] = useState<LicenseHistoryResponse | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const activeController = useRef<AbortController | null>(null);

  const load = useCallback(() => setRefreshNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    activeController.current = controller;
    setPhase('loading');
    setError(null);

    fetchLicenseHistory(
      {
        query: submitted.query || undefined,
        from: submitted.from || undefined,
        to: submitted.to || undefined,
        page,
        limit: pageSize,
      },
      controller.signal,
    )
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
  }, [submitted, page, pageSize, refreshNonce]);

  const applyFilters = useCallback(() => {
    setPage(1);
    setSubmitted({
      query: search.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
    });
  }, [search, from, to]);

  const reset = useCallback(() => {
    activeController.current?.abort();
    setSearch('');
    setFrom('');
    setTo('');
    setSubmitted({});
    setPage(1);
    setResult(null);
    setError(null);
    setPhase('idle');
  }, []);

  return {
    search,
    setSearch,
    from,
    setFrom,
    to,
    setTo,
    page,
    setPage,
    pageSize,
    setPageSize,
    applyFilters,
    load,
    reset,
    result,
    phase,
    error,
  };
}
