import { useState } from 'react';
import { Check, Copy, ExternalLink, History, Sparkles, User } from 'lucide-react';

import { AssetDetailsDialog, buildAssetMetadataText } from '@/components/assets/AssetDetailsDialog';
import { AssetImage } from '@/components/assets/AssetImage';
import { HistoryPanel } from '@/components/dashboard/HistoryPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn, copyToClipboard, formatCount, formatDate } from '@/lib/utils';
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

export function AssetCard({ asset }: { asset: Asset }) {
  const [showHistory, setShowHistory] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [copiedMetadata, setCopiedMetadata] = useState(false);
  const viewUrl = asset.assetUrl ?? undefined;
  const portfolioUrl = asset.creatorId ? `https://stock.adobe.com/contributor/${asset.creatorId}` : null;
  const keywordsText = asset.keywords && asset.keywords.length > 0 ? asset.keywords.join(', ') : null;
  const metadataText = buildAssetMetadataText(asset);

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

  return (
    <Card className="group flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <a href={viewUrl} target="_blank" rel="noreferrer" className="block">
        <div className="relative">
          <AssetImage src={asset.thumbnail} alt={asset.title ?? `Asset ${asset.id}`} className="aspect-[4/3]" />
          <div className="absolute top-2 left-2 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="bg-background/90 backdrop-blur">
              {CONTENT_TYPE_LABELS[asset.contentType] ?? 'Asset'}
            </Badge>
            {statusBadge}
            {asset.isGenerativeAI === true && (
              <Badge variant="outline" className="bg-background/90 backdrop-blur">
                <Sparkles className="size-3" />
                Generative AI
              </Badge>
            )}
          </div>
        </div>
      </a>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <a
          href={viewUrl}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-2 text-sm font-medium"
          title={asset.title ?? undefined}
        >
          {asset.title ?? 'Untitled asset'}
        </a>

        <dl className="space-y-1 text-xs text-muted-foreground">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0">Asset ID</dt>
            <dd className="truncate font-mono text-[11px]" title={`Asset ID ${asset.id}`}>
              #{asset.id}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0">Downloads</dt>
            <dd className="shrink-0 text-right">
              {asset.downloads === null ? 'Not available from official public API' : formatCount(asset.downloads)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0">Upload date</dt>
            <dd className="shrink-0 text-right">Not available from official public API</dd>
          </div>
          {asset.popularity && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">Popularity signal</dt>
              <dd className="shrink-0 text-right font-medium" title="Ranking-derived estimate, not a real download count">
                {asset.popularity.percentile.toFixed(1)}% rank #{asset.popularity.rank}
              </dd>
            </div>
          )}
          {asset.category && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">Category</dt>
              <dd className="truncate text-right" title={asset.category}>
                {asset.category}
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
          {asset.isTransparent !== null && (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">Transparency</dt>
              <dd className="shrink-0 text-right">{asset.isTransparent ? 'Transparent' : 'Opaque'}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0">Creator</dt>
            <dd className="truncate text-right" title={asset.creatorName ?? undefined}>
              {asset.creatorName ?? 'Unavailable'}
            </dd>
          </div>
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

        {asset.keywords && asset.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {asset.keywords.slice(0, 5).map((keyword) => (
              <Badge key={keyword} variant="outline" className="text-[10px] font-normal">
                {keyword}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5 border-t px-3 py-2">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
          <a href={viewUrl} target="_blank" rel="noreferrer">
            <ExternalLink />
            View on Adobe
          </a>
        </Button>
        {portfolioUrl && (
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <a href={portfolioUrl} target="_blank" rel="noreferrer">
              <User />
              Portfolio
            </a>
          </Button>
        )}
        <CopyButton label="Copy ID" value={asset.id} />
        <CopyButton label="Copy keywords" value={keywordsText ?? ''} />
        <Button variant="outline" size="sm" onClick={copyMetadata} title="Copy full asset metadata as plain text">
          {copiedMetadata ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
          {copiedMetadata ? 'Copied' : 'Copy metadata'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowDetails(true)} disabled={!asset.id}>
          <History />
          View details
        </Button>
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
