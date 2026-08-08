import {
  Box,
  Clock,
  Download,
  ExternalLink,
  Image,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  Palette,
  Shapes,
  Sparkles,
  Unplug,
  Video,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { AssetSearchFilter, AssetSearchLinks, AssetSearchSort } from '@/types';

const SORT_BUTTONS: ReadonlyArray<{ key: AssetSearchSort; label: string; icon: typeof Clock }> = [
  { key: 'relevance', label: 'Relevance', icon: Sparkles },
  { key: 'downloads', label: 'Most downloaded', icon: Download },
  { key: 'newest', label: 'Newest', icon: Clock },
];

const FILTER_BUTTONS: ReadonlyArray<{ key: AssetSearchFilter; label: string; icon: typeof Image }> = [
  { key: 'all', label: 'All', icon: LayoutGrid },
  { key: 'photo', label: 'Photo', icon: Image },
  { key: 'illustration', label: 'Illustration', icon: Palette },
  { key: 'vector', label: 'Vector', icon: Shapes },
  { key: 'transparent', label: 'PNG · Transparent', icon: Layers },
  { key: 'video', label: 'Video', icon: Video },
  { key: 'template', label: 'Template', icon: LayoutTemplate },
  { key: '3d', label: '3D', icon: Box },
];

interface AssetSearchLinksPanelProps {
  links: AssetSearchLinks;
}

/**
 * Shown in search-link mode for the Asset / Title search. Like the creator
 * search-link mode, this never fetches data — it only opens Adobe's own
 * stock.adobe.com result pages for a given search query in a new tab.
 */
export function AssetSearchLinksPanel({ links }: AssetSearchLinksPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2.5">
          <Unplug className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">API not connected — search-link mode is active</p>
            <p className="text-xs opacity-90">
              No Adobe Stock API credentials are configured, so live asset data can't be shown. The search is
              generating official stock.adobe.com result links for “{links.query}” — use the buttons below to open
              Adobe's own result pages in a new tab. Add a free Adobe Stock API key to enable live results.
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0 bg-white/60">
          <a href={links.viewUrl} target="_blank" rel="noreferrer">
            <ExternalLink />
            Open on Adobe Stock
          </a>
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border/70 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-full text-xs font-medium tracking-wide text-muted-foreground uppercase sm:w-auto">Sort</span>
          {SORT_BUTTONS.map(({ key, label, icon: Icon }) => (
            <Button asChild key={key} variant="outline" size="sm">
              <a href={links.sort[key]} target="_blank" rel="noreferrer" title={`Open "${label}" results on Adobe Stock`}>
                <Icon />
                {label}
              </a>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-full text-xs font-medium tracking-wide text-muted-foreground uppercase sm:w-auto">
            Content type
          </span>
          {FILTER_BUTTONS.map(({ key, label, icon: Icon }) => (
            <Button asChild key={key} variant="outline" size="sm">
              <a href={links.filters[key]} target="_blank" rel="noreferrer" title={`Open "${label}" results on Adobe Stock`}>
                <Icon />
                {label}
              </a>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
