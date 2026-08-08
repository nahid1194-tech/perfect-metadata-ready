import { Check, Copy, ExternalLink, Sparkles, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/utils';
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

function Availability({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <dt className="shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-right text-xs">{value}</dd>
    </div>
  );
}

/** Honest per-field metadata for an asset, including explicit availability. */
export function buildAssetMetadataText(asset: Asset): string {
  const lines = [
    `Asset ID: ${asset.id || 'unavailable'}`,
    `Title: ${asset.title ?? 'unavailable'}`,
    `Content type: ${CONTENT_TYPE_LABELS[asset.contentType] ?? asset.contentType}`,
    `Creator: ${asset.creatorName ?? 'unavailable'} (ID ${asset.creatorId || 'unavailable'})`,
    `Category: ${asset.category ?? 'unavailable'}`,
    `Dimensions: ${asset.width && asset.height ? `${asset.width} × ${asset.height}` : 'unavailable'}`,
    `Generative AI: ${asset.isGenerativeAI === null ? 'unavailable' : asset.isGenerativeAI ? 'Yes' : 'No'}`,
    `Transparency: ${asset.isTransparent === null ? 'unavailable' : asset.isTransparent ? 'Transparent' : 'Opaque'}`,
    `Keywords: ${asset.keywords && asset.keywords.length > 0 ? asset.keywords.join(', ') : 'unavailable'}`,
    `Description: ${asset.description ?? 'unavailable'}`,
    `Download count: not provided by Adobe Stock Search API`,
    `Upload date: not provided by official public Stock API`,
    `License history: requires an authorized Adobe account`,
  ];
  return lines.join('\n');
}

/**
 * Full metadata view for one asset. Every field is labeled honestly — values
 * Adobe does not expose (download counts, upload dates, license history) are
 * stated as unavailable, never estimated.
 */
export function AssetDetailsDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (label: string, value: string) => {
    const ok = await copyToClipboard(value);
    if (!ok) return;
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const viewUrl = asset.assetUrl ?? undefined;
  const keywordsText = asset.keywords && asset.keywords.length > 0 ? asset.keywords.join(', ') : '';
  const metadataText = buildAssetMetadataText(asset);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Asset details">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Asset details</p>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-[220px_1fr]">
          <div className="space-y-2">
            <img
              src={asset.thumbnail ?? undefined}
              alt={asset.title ?? `Asset ${asset.id}`}
              className="aspect-[4/3] w-full rounded-lg object-cover"
            />
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{CONTENT_TYPE_LABELS[asset.contentType] ?? 'Asset'}</Badge>
              {asset.isGenerativeAI === true && (
                <Badge variant="outline">
                  <Sparkles className="size-3" />
                  Generative AI
                </Badge>
              )}
              {asset.isTransparent === true && <Badge variant="outline">Transparent</Badge>}
            </div>
            {viewUrl && (
              <Button asChild variant="outline" size="sm" className="w-full">
                <a href={viewUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  View on Adobe Stock
                </a>
              </Button>
            )}
          </div>

          <div className="min-w-0 space-y-3">
            <h3 className="text-base font-semibold" title={asset.title ?? undefined}>
              {asset.title ?? 'Untitled asset'}
            </h3>

            <dl className="space-y-0">
              <Availability label="Asset ID" value={asset.id || 'unavailable'} />
              <Availability
                label="Creator"
                value={
                  asset.creatorName
                    ? `${asset.creatorName} (ID ${asset.creatorId || 'unavailable'})`
                    : asset.creatorId
                      ? `ID ${asset.creatorId}`
                      : 'unavailable'
                }
              />
              <Availability label="Content type" value={CONTENT_TYPE_LABELS[asset.contentType] ?? asset.contentType} />
              <Availability label="Category" value={asset.category ?? 'unavailable'} />
              <Availability
                label="Dimensions"
                value={asset.width && asset.height ? `${asset.width} × ${asset.height}` : 'unavailable'}
              />
              <Availability
                label="Generative AI"
                value={asset.isGenerativeAI === null ? 'unavailable' : asset.isGenerativeAI ? 'Yes' : 'No'}
              />
              <Availability
                label="Transparency"
                value={asset.isTransparent === null ? 'unavailable' : asset.isTransparent ? 'Transparent' : 'Opaque'}
              />
              <Availability label="Keywords" value={keywordsText || 'unavailable'} />
              <Availability label="Description" value={asset.description ?? 'unavailable'} />
              <Availability
                label="Download count"
                value="Not provided by Adobe Stock Search API"
              />
              <Availability label="Upload date" value="Not provided by official public Stock API" />
              <Availability
                label="License history"
                value="Requires an authorized Adobe account (see My License History)"
              />
            </dl>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => copy('id', asset.id)}>
                {copied === 'id' ? <Check className="text-emerald-600" /> : <Copy />}
                {copied === 'id' ? 'Copied' : 'Copy Asset ID'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => copy('keywords', keywordsText)} disabled={!keywordsText}>
                {copied === 'keywords' ? <Check className="text-emerald-600" /> : <Copy />}
                {copied === 'keywords' ? 'Copied' : 'Copy Keywords'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => copy('metadata', metadataText)}>
                {copied === 'metadata' ? <Check className="text-emerald-600" /> : <Copy />}
                {copied === 'metadata' ? 'Copied' : 'Copy Metadata'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
