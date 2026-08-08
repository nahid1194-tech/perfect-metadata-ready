import { useMemo } from 'react';
import { Calendar, Download, ExternalLink, FileText, Lock, RefreshCw, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useLicenseHistory } from '@/hooks/useLicenseHistory';
import { exportLicenseHistoryCsv } from '@/lib/csv';

function formatLicenseDate(iso: string | null, raw: string | null): string {
  if (iso) {
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    }
  }
  return raw ?? 'Unavailable';
}

/**
 * "My License History" — the authenticated account's own licensing history
 * from the official Adobe License History API. This is the authenticated
 * customer's license history ONLY, never another contributor's download
 * history. Shows a clear message when no authorized account is connected.
 */
export function LicenseHistoryPage() {
  const {
    search,
    setSearch,
    from,
    setFrom,
    to,
    setTo,
    page,
    setPage,
    pageSize,
    applyFilters,
    load,
    result,
    phase,
    error,
  } = useLicenseHistory();

  const loading = phase === 'loading';
  const entries = result?.entries ?? [];
  const total = result?.total ?? null;
  const totalPages = useMemo(() => {
    if (total === null) return 1;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [total, pageSize]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <FileText className="size-5 text-muted-foreground" />
            My License History
          </h2>
          <p className="text-xs text-muted-foreground">
            Source: Adobe Stock License History API · your own licensed assets, never another contributor&apos;s.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      <Card className="border-border/70">
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="license-search" className="text-xs">
                Search your licensed assets
              </Label>
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="license-search"
                  className="pl-8"
                  placeholder="Title, creator, asset ID…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') applyFilters();
                  }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="license-from" className="text-xs">
                Licensed from
              </Label>
              <Input id="license-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="license-to" className="text-xs">
                Licensed to
              </Label>
              <Input id="license-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={applyFilters}>
                <Search />
                Search
              </Button>
              <Button variant="outline" size="sm" onClick={applyFilters}>
                <Calendar />
                Filter
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              {total === null ? 'Loading…' : `${total} licensed asset${total === 1 ? '' : 's'}`}
              {result?.scanned !== undefined && result.scanned > 0 && ` · scanned ${result.scanned}`}
              {result?.truncated && ' · older entries not scanned — refine the search'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportLicenseHistoryCsv(entries)}
              disabled={entries.length === 0}
            >
              <Download />
              Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && !loading && <ErrorState error={error} onRetry={load} />}

      {!error && result && !result.authorized && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">License History requires an authorized Adobe account.</p>
            <p className="text-xs opacity-90">{result.sourceMessage}</p>
          </div>
        </div>
      )}

      {!error && result && result.authorized && result.notice && (
        <p className="text-xs text-muted-foreground">{result.notice}</p>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : !error && result && result.authorized && entries.length === 0 ? (
        <EmptyState
          title="No licensed assets found"
          description={
            result.source === 'empty'
              ? 'No licenses match your search or date window. Adjust the filters to see more of your history.'
              : 'No licensing data is available yet.'
          }
        />
      ) : !error && result && result.authorized ? (
        <ul className="grid grid-cols-1 gap-2">
          {entries.map((entry) => (
            <li key={`${entry.assetId}-${entry.licenseDateRaw ?? entry.licenseDate}`}>
              <Card className="border-border/70">
                <CardContent className="flex items-center gap-3 p-3">
                  {entry.thumbnailUrl && (
                    <img
                      src={entry.thumbnailUrl}
                      alt={entry.title ?? `Asset ${entry.assetId}`}
                      className="h-16 w-20 shrink-0 rounded object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-medium" title={entry.title ?? undefined}>
                      {entry.title ?? 'Untitled asset'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Asset ID <span className="font-mono">#{entry.assetId}</span>
                      {entry.creatorName && <span> · {entry.creatorName}</span>}
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>Licensed: {formatLicenseDate(entry.licenseDate, entry.licenseDateRaw)}</span>
                      {entry.licenseType && <Badge variant="outline" className="text-[10px] font-normal">{entry.licenseType}</Badge>}
                    </p>
                  </div>
                  {entry.detailsUrl && (
                    <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                      <a href={entry.detailsUrl} target="_blank" rel="noreferrer">
                        <ExternalLink />
                        View on Adobe
                      </a>
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && result?.authorized && entries.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((current) => current + 1)}
            disabled={!result?.hasMore}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  );
}
