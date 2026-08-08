import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchAssetSearch, fetchAssetSearchLinks } from '@/lib/api';
import type {
  ApiError,
  Asset,
  AssetSearchFilter,
  AssetSearchLinks,
  AssetSearchSort,
  ProviderMode,
  SourceStatus,
} from '@/types';

type Phase = 'idle' | 'loading' | 'loading-more' | 'loaded';

const PAGE_SIZE = 100;
const QUERY_MAX_LENGTH = 300;

export function useAssetSearch() {
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [query, setQuery] = useState<string | null>(null);

  const [filter, setFilter] = useState<AssetSearchFilter>('all');
  const [sort, setSort] = useState<AssetSearchSort>('relevance');

  const [mode, setMode] = useState<ProviderMode | null>(null);
  const [links, setLinks] = useState<AssetSearchLinks | null>(null);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus | null>(null);
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const activeController = useRef<AbortController | null>(null);

  const submit = useCallback(() => {
    const value = input.trim();
    if (!value) {
      setInputError('Enter a title, keyword, or search phrase.');
      return;
    }
    if (value.length > QUERY_MAX_LENGTH) {
      setInputError(`Search phrase must be at most ${QUERY_MAX_LENGTH} characters.`);
      return;
    }
    setInputError(null);
    setQuery(value);
  }, [input]);

  const reset = useCallback(() => {
    activeController.current?.abort();
    setQuery(null);
    setMode(null);
    setLinks(null);
    setAssets([]);
    setTotal(null);
    setHasMore(false);
    setPage(0);
    setSourceStatus(null);
    setSourceMessage(null);
    setNotice(null);
    setProvider(null);
    setError(null);
    setPhase('idle');
    setFilter('all');
    setSort('relevance');
    setInput('');
    setInputError(null);
  }, []);

  // Resolve the provider mode + keyword search links for the query. In "link"
  // mode this is everything the dashboard needs; no asset data is fetched.
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    activeController.current = controller;
    setPhase('loading');
    setError(null);
    setMode(null);
    setLinks(null);

    fetchAssetSearchLinks(query, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setLinks(res);
        setMode(res.mode);
        setProvider(res.provider);
        if (res.mode === 'link') {
          setAssets([]);
          setTotal(null);
          setHasMore(false);
          setPage(0);
          setSourceStatus(null);
          setSourceMessage(null);
          setNotice(null);
          setPhase('loaded');
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err as ApiError);
        setPhase('loaded');
      });

    return () => controller.abort();
  }, [query, refreshNonce]);

  // In "api" mode: fetch page 1 whenever the query/filter/sort changes.
  useEffect(() => {
    if (!query) return;
    if (mode !== 'api') return;
    const controller = new AbortController();
    activeController.current = controller;
    setPhase('loading');
    setError(null);
    setAssets([]);
    setPage(0);

    fetchAssetSearch(query, { filter, sort, page: 1, limit: PAGE_SIZE }, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setAssets(res.assets);
        setTotal(res.total);
        setHasMore(res.hasMore);
        setPage(res.page);
        setSourceStatus(res.source);
        setSourceMessage(res.sourceMessage ?? null);
        setNotice(res.notice ?? null);
        setProvider(res.provider ?? null);
        setPhase('loaded');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err as ApiError);
        setPhase('loaded');
      });

    return () => controller.abort();
  }, [query, mode, filter, sort, refreshNonce]);

  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  const loadMore = useCallback(() => {
    if (mode !== 'api') return;
    if (!query || phase === 'loading' || phase === 'loading-more') return;
    if (!hasMore) return;
    const controller = new AbortController();
    activeController.current = controller;
    setPhase('loading-more');

    fetchAssetSearch(query, { filter, sort, page: page + 1, limit: PAGE_SIZE }, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setAssets((prev) => {
          const seen = new Set(prev.map((a) => a.id));
          return [...prev, ...res.assets.filter((a) => !seen.has(a.id))];
        });
        setTotal(res.total);
        setHasMore(res.hasMore);
        setPage(res.page);
        setSourceStatus(res.source);
        setSourceMessage(res.sourceMessage ?? null);
        setNotice(res.notice ?? null);
        setProvider(res.provider ?? null);
        setPhase('loaded');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err as ApiError);
        setPhase('loaded');
      });
  }, [query, mode, phase, hasMore, filter, sort, page]);

  const changeFilter = useCallback((value: AssetSearchFilter) => setFilter(value), []);
  const changeSort = useCallback((value: AssetSearchSort) => setSort(value), []);

  return {
    input,
    setInput,
    inputError,
    submit,
    reset,
    query,
    mode,
    links,
    filter,
    sort,
    changeFilter,
    changeSort,
    assets,
    total,
    hasMore,
    page,
    sourceStatus,
    sourceMessage,
    notice,
    provider,
    phase,
    error,
    loadMore,
    refresh,
  };
}
