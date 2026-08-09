import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, History, ImageIcon, Sparkles, User } from 'lucide-react';

import { AssetDetailsDialog, buildAssetMetadataText } from '@/components/assets/AssetDetailsDialog';
import { AssetImage } from '@/components/assets/AssetImage';
import { HistoryPanel } from '@/components/dashboard/HistoryPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn, copyToClipboard, formatBytes, formatCount, formatDate, formatDuration } from '@/lib/utils';
import type { Asset } from '@/types';

const CONTENT_TYPE_LABELS: Record<string, string> = {
  photo: 'Photo',
  illustration: 'Illustration',
  vector: 'Vector',
  video: 'Video',
  template: 'Template',
  '3d': '3D',
  audio: 'Audio',
  unknown: 'Asset',
};

const TITLE_LONG_THRESHOLD = 72;
const KEYWORD_PREVIEW_COUNT = 5;

function CopyButton({ label, value, className }: { label: string; value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(value);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleCopy} className={cn('text-xs', className)} title={copied ? 'Copied' : label}>
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

interface AssetCardProps {
  asset: Asset;
  /**
   * When provided, a "Find Similar Images" button is rendered that runs a
   * visual-similarity search for this asset (Adobe `search_parameters[similar]`).
   */
  onFindSimilar?: (assetId: string) => void;
}

export function AssetCard({ asset, onFindSimilar }: AssetCardProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showAllTitle, setShowAllTitle] = useState(false);
  const [showAllKeywords, setShowAllKeywords] = useState(false);
  const [copiedMetadata, setCopiedMetadata] = useState(false);
  const viewUrl = asset.assetUrl ?? undefined;
  const portfolioUrl = asset.creatorId ? `https://stock.adobe.com/contributor/${asset.creatorId}` : null;
  const keywordsText = asset.keywords && asset.keywords.length > 0 ? asset.keywords.join(', ') : null;
  const metadataText = buildAssetMetadataText(asset);

  const title = asset.title ?? 'Untitled asset';
  const titleIsLong = title.length > TITLE_LONG_THRESHOLD;
  const keywords = asset.keywords ?? [];
  const keywordsPreview = keywords.slice(0, KEYWORD_PREVIEW_COUNT);
  const keywordsAllShown = showAllKeywords || keywords.length <= KEYWORD_PREVIEW_COUNT;

  // Warn once (per asset) when Adobe returned no usable thumbnail so field
  // mapping problems surface in the console instead of silently hiding images.
  useEffect(() => {
    if (asset.id && !asset.thumbnail && !asset.thumbnail500 && !asset.thumbnailUrl && !asset.thumbnail1000) {
      console.warn(`No Adobe thumbnail available for asset: ${asset.id}`);
    }
  }, [asset.id, asset.thumbnail, asset.thumbnail500, asset.thumbnailUrl, asset.thumbnail1000]);

  const copyMetadata = async () => {
    const ok = await copyToClipboard(metadataText);
    if (!ok) return;
    setCopiedMetadata(true);
    window.setTimeout(() => setCopiedMetadata(false), 1500);
  };

  const statusBadge =
    asset.status === 'downloaded' ? (
      <Badge variant="success">Downloaded</Badge>
    ) : asset.status === 'undownloaded' ? (
      <Badge variant="warning">Undownloaded</Badge>
    ) : null;

  const categoryLabel = [asset.category, asset.categoryHierarchy && asset.categoryHierarchy !== asset.category ? asset.categoryHierarchy : null]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
    <Card className="group flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <a href={viewUrl} target="_blank" rel="noreferrer" className="block">
        <div className="relative">
          <AssetImage
            src={asset.thumbnail}
            thumbnail1000={asset.thumbnail1000}
            thumbnail500={asset.thumbnail500}
            thumbnailUrl={asset.thumbnailUrl}
            alt={title}
            className="aspect-[4/3]"
          />
          <div className="absolute top-2 left-2 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="bg-background/90 backdrop-blur">
              {CONTENT_TYPE_LABELS[asset.contentType] ?? 'Asset'}
            </Badge>
            {statusBadge}
            {asset.isGenerativeAI === true && (
              <Badge variant="outline" className="bg-background/90 backdrop-blur">
                <Sparkles className="size-3" />
                AI
              </Badge>
            )}
            {asset.isPremium === true && (
              <Badge variant="outline" className="bg-background/90 backdrop-blur">
                Premium
              </Badge>
            )}
          </div>
        </div>
      </a>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <a
            href={viewUrl}
            target="_blank"
            rel="noreferrer"
            className={cn('min-w-0 text-sm font-medium', !showAllTitle && 'line-clamp-2')}
            title={title}
          >
            {title}
          </a>
          {titleIsLong && (
            <Button
              variant="ghost"
              size="sm"
              className="-mt-0.5 shrink-0 text-[11px] px-1.5"
              onClick={() => setShowAllTitle((prev) => !prev)}
            >
              {showAllTitle ? 'Show less' : 'Show all'}
            </Button>
          )}
        </div>

        <dl className="space-y-1 text-xs text-muted-foreground">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0">Asset ID</dt>
            <dd className="truncate font-mono text-[11px]" title={`Asset ID ${asset.id}`}>
              #{asset.id}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0">Creator ID</dt>
            <dd className="truncate font-mono text-[11px] text-right" title={`Contributor ID ${asset.creatorId}`}>
              #{asset.creatorId}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0">Creator</dt>
            <dd className="truncate text-right" title={asset.creatorName ?? undefined}>
              {asset.creatorName ?? 'Unavailable'}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0">Downloads</dt>
            <dd className="shrink-0 text-right" title="Exact download counts are not provided by the official Adobe Stock API">
              {asset.downloads === null ? 'Download data unavailable' : formatCount(asset.downloads)}
            </dd>
          </div>
          {asset.popularity && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">Popularity signal</dt>
              <dd className="shrink-0 text-right font-medium" title="Ranking-derived estimate, not a real download count">
                {asset.popularity.percentile.toFixed(1)}% rank #{asset.popularity.rank}
              </dd>
            </div>
          )}
          {categoryLabel && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">Category</dt>
              <dd className="truncate text-right" title={categoryLabel}>
                {categoryLabel}
              </dd>
            </div>
          )}
          {asset.width && asset.height ? (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">Dimensions</dt>
              <dd className="shrink-0 text-right">
                {asset.width} × {asset.height}
              </dd>
            </div>
          ) : null}
          {asset.vectorType && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">Vector type</dt>
              <dd className="shrink-0 text-right">{asset.vectorType}</dd>
            </div>
          )}
          {asset.contentType === 'video' && asset.duration !== null && asset.duration !== undefined && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">Duration</dt>
              <dd className="shrink-0 text-right tabular-nums">{formatDuration(asset.duration)}</dd>
            </div>
          )}
          {asset.contentType === 'video' && asset.framerate !== null && asset.framerate !== undefined && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">Frame rate</dt>
              <dd className="shrink-0 text-right tabular-nums">{asset.framerate} fps</dd>
            </div>
          )}
          {asset.sizeBytes !== null && asset.sizeBytes !== undefined && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">File size</dt>
              <dd className="shrink-0 text-right tabular-nums">{formatBytes(asset.sizeBytes)}</dd>
            </div>
          )}
          {asset.countryName && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">Country</dt>
              <dd className="shrink-0 text-right">{asset.countryName}</dd>
            </div>
          )}
          {asset.isTransparent !== null && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">Transparent</dt>
              <dd className="shrink-0 text-right">{asset.isTransparent ? 'Yes' : 'No'}</dd>
            </div>
          )}
          {asset.observationCount !== null && asset.observationCount !== undefined && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">Observations</dt>
              <dd className="shrink-0 text-right tabular-nums">{formatCount(asset.observationCount)}</dd>
            </div>
          )}
          {asset.firstSeenAt && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">First seen</dt>
              <dd className="shrink-0 text-right">{formatDate(asset.firstSeenAt)}</dd>
            </div>
          )}
        </dl>

        {keywords.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {(keywordsAllShown ? keywords : keywordsPreview).map((keyword) => (
              <Badge key={keyword} variant="outline" className="text-[10px] font-normal">
                {keyword}
              </Badge>
            ))}
            {keywords.length > KEYWORD_PREVIEW_COUNT && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[11px]"
                onClick={() => setShowAllKeywords((prev) => !prev)}
              >
                {showAllKeywords ? 'Show less' : `Show all (${keywords.length})`}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5 border-t px-3 py-2">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
          <a href={viewUrl} target="_blank" rel="noreferrer">
            <ExternalLink />
            View on Adobe Stock
          </a>
        </Button>
        {portfolioUrl && (
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <a href={portfolioUrl} target="_blank" rel="noreferrer">
              <User />
              View Portfolio
            </a>
          </Button>
        )}
        <CopyButton label="Copy ID" value={asset.id} />
        <CopyButton label="Copy title" value={title} />
        <CopyButton label="Copy keywords" value={keywordsText ?? ''} />
        <Button variant="outline" size="sm" onClick={copyMetadata} title="Copy full asset metadata as plain text">
          {copiedMetadata ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
          {copiedMetadata ? 'Copied' : 'Copy metadata'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowDetails(true)} disabled={!asset.id}>
          <History />
          View details
        </Button>
        {onFindSimilar && (
          <Button variant="outline" size="sm" onClick={() => onFindSimilar(asset.id)} disabled={!asset.id} title="Search for visually similar images via the official Adobe Stock API">
            <ImageIcon />
            Find Similar
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="col-span-2"
          onClick={() => setShowHistory((prev) => !prev)}
          disabled={!asset.id}
        >
          <History />
          {showHistory ? 'Hide history' : 'History'}
        </Button>
      </div>

      {showHistory && <HistoryPanel assetId={asset.id || null} />}
      {showDetails && <AssetDetailsDialog asset={asset} onClose={() => setShowDetails(false)} />}
    </Card>
  );
}
