import { ExternalLink, Tag, User } from 'lucide-react';

import { CreatorAvailabilityPanel } from '@/components/dashboard/CreatorAvailabilityPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCount, formatDate } from '@/lib/utils';
import { useCreatorOverview } from '@/hooks/useCreatorOverview';

const CONTENT_TYPE_LABELS: Record<string, string> = {
  photo: 'Photo',
  illustration: 'Illustration',
  vector: 'Vector',
  video: 'Video',
  template: 'Template',
  '3d': '3D',
  audio: 'Audio',
  unknown: 'Unknown',
};

interface CreatorOverviewPanelProps {
  creatorId: string | null;
}

/** Creator dashboard assembled from the local index (top assets, keyword
 * analytics, content-type breakdown, first/last seen). */
export function CreatorOverviewPanel({ creatorId }: CreatorOverviewPanelProps) {
  const { overview, phase, error } = useCreatorOverview(creatorId);

  if (!creatorId) return null;
  const data = overview?.overview ?? null;
  const loading = phase === 'loading' && !data;

  if (loading) {
    return (
      <Card className="border-border/70">
        <CardContent className="space-y-3 p-4 sm:p-5">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">Could not load the creator dashboard: {error.message}</p>;
  }

  if (!data) {
    return (
      <Card className="border-border/70">
        <CardContent className="flex items-start gap-3 p-4 sm:p-5">
          <User className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No locally indexed data for this creator yet. Search their portfolio once and the dashboard (top assets,
            keywords, content-type breakdown, first/last seen) appears here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/70">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <User className="size-4 text-muted-foreground" />
              {data.creatorName ?? `Contributor #${data.adobeCreatorId}`}
            </h3>
            <p className="text-xs text-muted-foreground">
              Indexed since {formatDate(data.firstSeenAt) ?? '—'} · last updated {formatDate(data.lastSeenAt) ?? '—'}
            </p>
          </div>
          {data.portfolioUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={data.portfolioUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                View portfolio
              </a>
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Indexed assets</p>
            <p className="text-xl font-semibold tabular-nums">{formatCount(data.totalIndexedAssets)}</p>
          </div>
          {data.contentTypes.slice(0, 3).map(({ contentType, count }) => (
            <div key={contentType} className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{CONTENT_TYPE_LABELS[contentType] ?? contentType}</p>
              <p className="text-xl font-semibold tabular-nums">{formatCount(count)}</p>
            </div>
          ))}
        </div>

        {data.topKeywords.length > 0 && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Tag className="size-3.5" />
              Top keywords
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data.topKeywords.slice(0, 12).map(({ keyword, count }) => (
                <Badge key={keyword} variant="outline" className="text-[10px] font-normal">
                  {keyword} · {count}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {data.topAssets.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Top assets by metric</p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {data.topAssets.slice(0, 6).map((asset) => (
                <li key={asset.adobeAssetId} className="flex items-center gap-2.5 rounded-lg border border-border/70 p-2">
                  {asset.thumbnailUrl && (
                    <img src={asset.thumbnailUrl} alt="" className="h-10 w-12 shrink-0 rounded object-cover" loading="lazy" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium" title={asset.title ?? undefined}>
                      {asset.title ?? `#${asset.adobeAssetId}`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {asset.lastValue === null
                        ? 'no metric yet'
                        : `${formatCount(asset.lastValue)} ${asset.lastValueSource === 'official-api-exact' ? '(exact)' : '(signal)'}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {overview?.availability && <CreatorAvailabilityPanel availability={overview.availability} />}

        <p className="text-[11px] text-muted-foreground">Source: {overview?.storeLabel ?? 'local history index'}</p>
      </CardContent>
    </Card>
  );
}
