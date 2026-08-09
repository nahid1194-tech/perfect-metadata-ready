import { useEffect, useState } from 'react';
import { Check, ExternalLink, RotateCcw, ShieldCheck } from 'lucide-react';

import { AssetCard } from '@/components/assets/AssetCard';
import { AssetGrid, SkeletonGrid } from '@/components/assets/AssetGrid';
import { AssetIdSearchInput } from '@/components/dashboard/AssetIdSearchInput';
import { AssetSearchInput } from '@/components/dashboard/AssetSearchInput';
import { AssetSearchLinksPanel } from '@/components/dashboard/AssetSearchLinksPanel';
import { AssetSearchToolbar } from '@/components/dashboard/AssetSearchToolbar';
import { CreatorOverviewPanel } from '@/components/dashboard/CreatorOverviewPanel';
import { CreatorSearch } from '@/components/dashboard/CreatorSearch';
import { DashboardToolbar } from '@/components/dashboard/DashboardToolbar';
import { HistoryPanel } from '@/components/dashboard/HistoryPanel';
import { SearchLinkButtons } from '@/components/dashboard/SearchLinkButtons';
import { SearchModeTabs } from '@/components/dashboard/SearchModeTabs';
import { SettingsPage } from '@/components/dashboard/SettingsPage';
import { SimilarImagesPanel } from '@/components/dashboard/SimilarImagesPanel';
import { StatCards } from '@/components/dashboard/StatCards';
import { SummaryCards } from '@/components/dashboard/SummaryCards';
import { ApiNotConnected } from '@/components/feedback/ApiNotConnected';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { DataNote } from '@/components/feedback/DataNote';
import { PaginationBar } from '@/components/feedback/PaginationBar';
import { LoadingBanner, SourceBanner } from '@/components/feedback/SourceBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useAssetIdSearch } from '@/hooks/useAssetIdSearch';
import { useAssetSearch } from '@/hooks/useAssetSearch';
import { useCreatorAssets } from '@/hooks/useCreatorAssets';
import { useSummary } from '@/hooks/useSummary';
import { Header, type AppPage } from '@/components/layout/Header';
import { LicenseHistoryPage } from '@/components/dashboard/LicenseHistoryPage';
import { formatCount } from '@/lib/utils';
import type { SearchMode, SourceStatus } from '@/types';

const PROBLEM_SOURCES: SourceStatus[] = ['blocked', 'unavailable', 'rate_limited', 'timeout', 'error'];

export default function App() {
  const [searchMode, setSearchMode] = useState<SearchMode>('creator');
  const [page, setPage] = useState<AppPage>('dashboard');
  const [showSimilar, setShowSimilar] = useState(false);

  const summary = useSummary();
  const creator = useCreatorAssets();
  const asset = useAssetSearch();
  const assetId = useAssetIdSearch();

  const {
    creatorId,
    mode: creatorMode,
    links: creatorLinks,
    phase: creatorPhase,
    error: creatorError,
    sourceStatus: creatorSourceStatus,
    sourceMessage: creatorSourceMessage,
    notice: creatorNotice,
    provider: creatorProvider,
    stats,
    assets: creatorAssets,
    total: creatorTotal,
    hasMore: creatorHasMore,
  } = creator;

  const {
    query,
    mode: assetMode,
    links: assetLinks,
    phase: assetPhase,
    error: assetError,
    sourceStatus: assetSourceStatus,
    sourceMessage: assetSourceMessage,
    notice: assetNotice,
    provider: assetProvider,
    assets: assetAssets,
    total: assetTotal,
  } = asset;

  const {
    assetId: assetIdValue,
    mode: assetIdMode,
    links: assetIdLinks,
    phase: assetIdPhase,
    error: assetIdError,
    sourceStatus: assetIdSourceStatus,
    sourceMessage: assetIdSourceMessage,
    notice: assetIdNotice,
    provider: assetIdProvider,
    asset: assetIdAsset,
    result: assetIdResult,
  } = assetId;

  // The "Find Similar Images" panel belongs to one specific asset lookup;
  // reset it whenever the asset ID (or the page/section) changes.
  useEffect(() => {
    setShowSimilar(false);
  }, [assetIdValue, page, searchMode]);

  const isCreatorMode = searchMode === 'creator';
  const isAssetMode = searchMode === 'asset';
  const isAssetIdMode = searchMode === 'asset-id';

  const activePhase = isCreatorMode ? creatorPhase : isAssetMode ? assetPhase : assetIdPhase;
  const isIdle = activePhase === 'idle';
  const initialLoading = activePhase === 'loading';
  const activeMode = isCreatorMode ? creatorMode : isAssetMode ? assetMode : assetIdMode;
  const isLinkMode = activeMode === 'link';
  const isApiMode = activeMode === 'api';

  const showSourceBanner =
    isCreatorMode && !!creatorSourceStatus && PROBLEM_SOURCES.includes(creatorSourceStatus);

  // Prefer the stats source when available; it aggregates more upstream queries.
  const banner =
    stats && PROBLEM_SOURCES.includes(stats.source)
      ? { source: stats.source, message: stats.sourceMessage ?? '' }
      : showSourceBanner
        ? { source: creatorSourceStatus as SourceStatus, message: creatorSourceMessage ?? '' }
        : null;

  // After a successful Creator search the dashboard counters are derived from
  // the actual returned API results. They never claim to represent the
  // contributor's complete portfolio (the API filters out premium assets and
  // the app only loads the pages fetched so far).
  const summaryOverride =
    isCreatorMode && isApiMode && creatorSourceStatus === 'ok' && creatorTotal !== null
      ? {
          totalAssets: creatorTotal,
          indexedAssets: creatorAssets.length,
          assetsWithAvailableMetrics: creatorAssets.filter(
            (asset) =>
              asset.popularity !== null ||
              asset.downloads !== null ||
              (asset.observationCount !== null && asset.observationCount > 0),
          ).length,
          totalObservations: creatorAssets.reduce((sum, asset) => sum + (asset.observationCount ?? 0), 0),
          note:
            creatorHasMore || creatorTotal > creatorAssets.length
              ? 'API total; loaded pages only'
              : 'API total for the current search',
        }
      : null;

  const heroTitle = isCreatorMode
    ? 'Analyze any Adobe Stock contributor'
    : isAssetMode
      ? 'Search Adobe Stock by title or keyword'
      : 'Look up one Adobe Stock asset';
  const heroDescription = isCreatorMode
    ? 'Enter a contributor numeric Creator ID to open their public assets on Adobe Stock — or connect a free Adobe Stock API key for full in-app analytics.'
    : isAssetMode
      ? 'Enter a title, keyword, or search phrase to find matching assets on Adobe Stock — or connect a free Adobe Stock API key for live results in-app.'
      : 'Enter the numeric media ID of a single asset to inspect it — or connect a free Adobe Stock API key for its live details and history in-app.';

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header page={page} onNavigate={setPage} />

      {page === 'license-history' ? (
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          <LicenseHistoryPage />
        </main>
      ) : page === 'settings' ? (
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          <SettingsPage />
        </main>
      ) : (
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        <div className="space-y-6">
          <SummaryCards
            summary={summary.summary}
            loading={summary.phase === 'loading'}
            onRefresh={summary.refresh}
            override={summaryOverride}
          />

          <div className="space-y-4">
            <SearchModeTabs value={searchMode} onValueChange={setSearchMode} />

            {isIdle && (
              <section className="pt-2 pb-4 text-center">
                <Badge variant="secondary" className="mb-4">
                  <ShieldCheck className="size-3" />
                  Open source · no Adobe login required
                </Badge>
                <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{heroTitle}</h2>
                <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">{heroDescription}</p>
              </section>
            )}

            <div className={isIdle ? 'mx-auto max-w-2xl' : undefined}>
              {isCreatorMode ? (
                <CreatorSearch
                  input={creator.input}
                  onInputChange={creator.setInput}
                  inputError={creator.inputError}
                  onSubmit={creator.submit}
                  loading={initialLoading}
                />
              ) : isAssetMode ? (
                <AssetSearchInput
                  input={asset.input}
                  onInputChange={asset.setInput}
                  inputError={asset.inputError}
                  onSubmit={asset.submit}
                  loading={initialLoading}
                />
              ) : (
                <AssetIdSearchInput
                  input={assetId.input}
                  onInputChange={assetId.setInput}
                  inputError={assetId.inputError}
                  onSubmit={assetId.submit}
                  loading={initialLoading}
                />
              )}
            </div>
          </div>

          {isCreatorMode && creatorId && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <h2 className="text-lg font-semibold tracking-tight">Contributor #{creatorId}</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm text-muted-foreground">
                      {creatorAssets[0]?.creatorName
                        ? `${creatorAssets[0].creatorName} · ${formatCount(creatorTotal ?? 0)} total assets found`
                        : 'Public assets from the Adobe Stock search index'}
                    </p>
                    {isApiMode && creatorSourceStatus === 'ok' && (
                      <Badge variant="success" className="gap-1">
                        <Check className="size-3" />
                        Adobe Stock API Connected
                      </Badge>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={creator.reset}>
                  <RotateCcw />
                  New analysis
                </Button>
              </div>

              {initialLoading && <LoadingBanner />}

              {!initialLoading && creatorError && <ErrorState error={creatorError} onRetry={creator.refresh} />}

              {!initialLoading && !creatorError && creatorLinks && isLinkMode && (
                <>
                  <ApiNotConnected links={creatorLinks} />
                  <SearchLinkButtons links={creatorLinks} />
                </>
              )}

              {!initialLoading && !creatorError && creatorLinks && isApiMode && (
                <>
                  {banner ? (
                    <SourceBanner source={banner.source} message={banner.message} />
                  ) : (
                    <DataNote notice={creatorNotice ?? stats?.notice} provider={creatorProvider ?? stats?.provider} />
                  )}

                  <SearchLinkButtons links={creatorLinks} compact />

                  <StatCards stats={stats} loading={initialLoading && !stats} />

                  <CreatorOverviewPanel creatorId={creatorId} />

                  <Separator />

                  <DashboardToolbar
                    filter={creator.filter}
                    sort={creator.sort}
                    contentType={creator.contentType}
                    disabled={initialLoading}
                    onFilterChange={creator.changeFilter}
                    onSortChange={creator.changeSort}
                    onContentTypeChange={creator.changeContentType}
                  />

                  <section aria-label="Assets">
                    {initialLoading && !creatorError && <SkeletonGrid />}

                    {!initialLoading && creatorError && <ErrorState error={creatorError} onRetry={creator.refresh} />}

                    {!initialLoading && !creatorError && creatorAssets.length > 0 && (
                      <>
                        <AssetGrid assets={creatorAssets} />
                        <PaginationBar
                          page={creator.page}
                          total={creatorTotal}
                          pageSize={100}
                          loading={creatorPhase === 'loading' || creatorPhase === 'loading-more'}
                          onPageChange={creator.goToPage}
                        />
                      </>
                    )}

                    {!initialLoading &&
                      !creatorError &&
                      creatorAssets.length === 0 &&
                      (creatorSourceStatus === 'empty' ||
                        (creatorSourceStatus && PROBLEM_SOURCES.includes(creatorSourceStatus))) && (
                        <EmptyState
                          title={creatorSourceStatus === 'empty' ? 'No public assets found.' : 'No data to display'}
                          description={
                            creatorSourceStatus === 'empty'
                              ? 'Adobe did not return any publicly visible assets for this Creator ID. Try another Creator ID.'
                              : 'The Adobe Stock API is unavailable, so no assets can be loaded. See the message above for details.'
                          }
                        />
                      )}
                  </section>
                </>
              )}
            </div>
          )}

          {isAssetMode && query && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight">Search results</h2>
                  <p className="truncate text-xs text-muted-foreground">“{query}” across the Adobe Stock catalog</p>
                </div>
                <Button variant="ghost" size="sm" onClick={asset.reset}>
                  <RotateCcw />
                  New search
                </Button>
              </div>

              {initialLoading && <LoadingBanner />}

              {!initialLoading && assetError && <ErrorState error={assetError} onRetry={asset.refresh} />}

              {!initialLoading && !assetError && assetLinks && isLinkMode && <AssetSearchLinksPanel links={assetLinks} />}

              {!initialLoading && !assetError && assetLinks && isApiMode && (
                <>
                  {assetSourceStatus && PROBLEM_SOURCES.includes(assetSourceStatus) ? (
                    <SourceBanner source={assetSourceStatus} message={assetSourceMessage ?? ''} />
                  ) : (
                    <DataNote notice={assetNotice ?? undefined} provider={assetProvider ?? undefined} />
                  )}

                  <AssetSearchToolbar
                    query={query}
                    total={assetTotal}
                    assets={assetAssets}
                    sort={asset.sort}
                    onSortChange={asset.changeSort}
                    filter={asset.filter}
                    onFilterChange={asset.changeFilter}
                    viewUrl={assetLinks.viewUrl}
                    onRefresh={asset.refresh}
                  />

                  <section aria-label="Assets">
                    {initialLoading && !assetError && <SkeletonGrid />}

                    {!initialLoading && assetError && <ErrorState error={assetError} onRetry={asset.refresh} />}

                    {!initialLoading && !assetError && assetAssets.length > 0 && (
                      <>
                        <AssetGrid assets={assetAssets} />
                        <PaginationBar
                          page={asset.page}
                          total={assetTotal}
                          pageSize={100}
                          loading={assetPhase === 'loading' || assetPhase === 'loading-more'}
                          onPageChange={asset.goToPage}
                        />
                      </>
                    )}

                    {!initialLoading &&
                      !assetError &&
                      assetAssets.length === 0 &&
                      (assetSourceStatus === 'empty' ||
                        (assetSourceStatus && PROBLEM_SOURCES.includes(assetSourceStatus))) && (
                        <EmptyState
                          title={assetSourceStatus === 'empty' ? 'No public assets found.' : 'No data to display'}
                          description={
                            assetSourceStatus === 'empty'
                              ? 'Adobe Stock returned no matches for this search. Try a different title or keyword.'
                              : 'The Adobe Stock API is unavailable, so no assets can be loaded. See the message above for details.'
                          }
                        />
                      )}
                  </section>
                </>
              )}
            </div>
          )}

          {isAssetIdMode && assetIdValue && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Asset #{assetIdValue}</h2>
                  <p className="text-xs text-muted-foreground">Single-asset lookup by Adobe media ID</p>
                </div>
                <Button variant="ghost" size="sm" onClick={assetId.reset}>
                  <RotateCcw />
                  New lookup
                </Button>
              </div>

              {initialLoading && <LoadingBanner />}

              {!initialLoading && assetIdError && <ErrorState error={assetIdError} onRetry={assetId.refresh} />}

              {!initialLoading && !assetIdError && assetIdLinks && isLinkMode && (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
                  <div className="space-y-2">
                    <p className="font-medium">Adobe Stock API is not configured.</p>
                    <p className="text-xs opacity-90">
                      {assetIdSourceMessage ??
                        'Configure Adobe Stock API credentials to display asset previews (set ADOBE_STOCK_API_KEY in server/.env).'}
                    </p>
                    <Button asChild variant="outline" size="sm">
                      <a href={assetIdLinks.link} target="_blank" rel="noreferrer">
                        <ExternalLink />
                        Open matching asset on Adobe Stock
                      </a>
                    </Button>
                  </div>
                </div>
              )}

              {!initialLoading && !assetIdError && assetIdLinks && isApiMode && (
                <>
                  {assetIdSourceStatus && PROBLEM_SOURCES.includes(assetIdSourceStatus) ? (
                    <SourceBanner source={assetIdSourceStatus} message={assetIdSourceMessage ?? ''} />
                  ) : (
                    <DataNote notice={assetIdNotice ?? undefined} provider={assetIdProvider ?? undefined} />
                  )}

                  {assetIdAsset ? (
                    <div className="mx-auto max-w-sm">
                      <AssetCard asset={assetIdAsset} onFindSimilar={() => setShowSimilar(true)} />
                    </div>
                  ) : (
                    <EmptyState
                      title="No asset found"
                      description={`Adobe Stock returned no asset with media ID ${assetIdValue}. Double-check the ID.`}
                    />
                  )}

                  {showSimilar && assetIdAsset && <SimilarImagesPanel assetId={assetIdValue} />}

                  {assetIdResult?.historyAvailable === false && (
                    <p className="text-xs text-muted-foreground">
                      Historical database is not configured — {assetIdResult.storeLabel}
                    </p>
                  )}

                  {assetIdAsset && <HistoryPanel assetId={assetIdValue} />}
                </>
              )}
            </div>
          )}
        </div>
        </main>
      )}

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
          <p>Adobe Stock Tracker — open-source contributor analytics. Not affiliated with Adobe.</p>
          <p>Only publicly available data is shown; nothing is fabricated.</p>
        </div>
      </footer>
    </div>
  );
}
