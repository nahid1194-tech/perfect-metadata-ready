import { useCallback, useEffect, useRef, useState } from 'react';
import { Images, Loader2 } from 'lucide-react';

import { AssetGrid, SkeletonGrid } from '@/components/assets/AssetGrid';
import { PaginationBar } from '@/components/feedback/PaginationBar';
import { SourceBanner } from '@/components/feedback/SourceBanner';
import { DataNote } from '@/components/feedback/DataNote';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Button } from '@/components/ui/button';
import { fetchSimilarAssets } from '@/lib/api';
import type { ApiError, Asset, SourceStatus } from '@/types';

const PAGE_SIZE = 100;
const PROBLEM_SOURCES: SourceStatus[] = ['blocked', 'unavailable', 'rate_limited', 'timeout', 'error'];

/**
 * "Find Similar Images" panel (Asset ID view). Runs Adobe's official
 * `search_parameters[similar]` search for an asset and shows the results
 * inline with numbered pagination.
 */
export function SimilarImagesPanel({ assetId }: { assetId: string }) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus | null>(null);
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (targetPage: number) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      setError(null);

      fetchSimilarAssets(assetId, { filter: 'all', sort: 'relevance', page: targetPage, limit: PAGE_SIZE }, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          setAssets(res.assets);
          setTotal(res.total);
          setPage(res.page);
          setSourceStatus(res.source);
          setSourceMessage(res.sourceMessage ?? null);
          setNotice(res.notice ?? null);
          setProvider(res.provider ?? null);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(err as ApiError);
          setLoading(false);
        });
    },
    [assetId],
  );

  useEffect(() => {
    if (!open) return;
    load(1);
    return () => controllerRef.current?.abort();
  }, [open, load, refreshNonce]);

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} title="Search for visually similar images via the official Adobe Stock API">
        <Images className="size-3.5" />
        Find Similar Images
      </Button>
    );
  }

  const showProblem = sourceStatus !== null && PROBLEM_SOURCES.includes(sourceStatus);

  return (
    <section aria-label="Similar images" className="space-y-3 rounded-lg border border-border/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Similar images</h3>
          <p className="text-xs text-muted-foreground">
            Visually similar assets for <span className="font-mono">#{assetId}</span> (Adobe Stock similarity search)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setRefreshNonce((n) => n + 1)} disabled={loading}>
            <Loader2 className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Hide
          </Button>
        </div>
      </div>

      {showProblem && <SourceBanner source={sourceStatus as SourceStatus} message={sourceMessage ?? ''} />}
      {!showProblem && <DataNote notice={notice ?? undefined} provider={provider ?? undefined} />}

      {loading && assets.length === 0 && <SkeletonGrid />}

      {!loading && error && (
        <p className="text-sm text-destructive">Could not load similar images: {error.message}</p>
      )}

      {!loading && !error && assets.length > 0 && (
        <>
          <AssetGrid assets={assets} />
          <PaginationBar
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            loading={loading}
            onPageChange={load}
          />
        </>
      )}

      {!loading && !error && assets.length === 0 && sourceStatus !== null && sourceStatus !== 'ok' && (
        <EmptyState title="Similar images unavailable" description="Adobe did not return similar images for this asset." />
      )}
    </section>
  );
}
