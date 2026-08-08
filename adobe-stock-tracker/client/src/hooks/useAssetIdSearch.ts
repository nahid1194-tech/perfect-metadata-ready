import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchAssetLinks, fetchAssetMetadata } from '@/lib/api';
import type {
  ApiError,
  Asset,
  AssetLinksResponse,
  AssetMetadataResponse,
  ProviderMode,
  SourceStatus,
} from '@/types';

type Phase = 'idle' | 'loading' | 'loaded';

/**
 * Asset ID search mode: look up a single asset by its numeric Adobe media ID.
 * Resolves provider mode first (link vs api), then fetches metadata + history
 * in api mode.
 */
export function useAssetIdSearch() {
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);

  const [mode, setMode] = useState<ProviderMode | null>(null);
  const [links, setLinks] = useState<AssetLinksResponse | null>(null);
  const [result, setResult] = useState<AssetMetadataResponse | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus | null>(null);
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const activeController = useRef<AbortController | null>(null);

  const submit = useCallback(() => {
    const id = input.trim();
    if (!id) {
      setInputError('Asset ID is required.');
      return;
    }
    if (!/^\d+$/.test(id)) {
      setInputError('Asset ID must be a numeric Adobe Stock asset (media) ID.');
      return;
    }
    setInputError(null);
    setAssetId(id);
  }, [input]);

  const reset = useCallback(() => {
    activeController.current?.abort();
    setAssetId(null);
    setMode(null);
    setLinks(null);
    setResult(null);
    setAsset(null);
    setSourceStatus(null);
    setSourceMessage(null);
    setNotice(null);
    setProvider(null);
    setError(null);
    setPhase('idle');
    setInput('');
    setInputError(null);
  }, []);

  // Resolve the provider mode + generated link for the asset ID.
  useEffect(() => {
    if (!assetId) return;
    const controller = new AbortController();
    activeController.current = controller;
    setPhase('loading');
    setError(null);
    setMode(null);
    setLinks(null);
    setResult(null);
    setAsset(null);

    fetchAssetLinks(assetId, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setLinks(res);
        setMode(res.mode);
        setProvider(res.provider);
        if (res.mode === 'link') {
          setSourceStatus('unavailable');
          setSourceMessage('API not connected. Live asset data requires an Adobe Stock API key.');
          setPhase('loaded');
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err as ApiError);
        setPhase('loaded');
      });

    return () => controller.abort();
  }, [assetId, refreshNonce]);

  // In "api" mode: fetch the asset metadata.
  useEffect(() => {
    if (!assetId || mode !== 'api') return;
    const controller = new AbortController();
    activeController.current = controller;
    setPhase('loading');
    setError(null);

    fetchAssetMetadata(assetId, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setResult(res);
        setAsset(res.asset);
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
  }, [assetId, mode, refreshNonce]);

  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  return {
    input,
    setInput,
    inputError,
    submit,
    reset,
    assetId,
    mode,
    links,
    result,
    asset,
    sourceStatus,
    sourceMessage,
    notice,
    provider,
    phase,
    error,
    refresh,
  };
}
