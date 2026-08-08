import { Archive, Clock, Download, ExternalLink, Image, Shapes } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { CreatorSearchLinks, SearchLinkFilter } from '@/types';

const FILTER_BUTTONS: ReadonlyArray<{ key: SearchLinkFilter; label: string; icon: typeof Download }> = [
  { key: 'downloaded', label: 'Downloaded', icon: Download },
  { key: 'undownloaded', label: 'Undownloaded', icon: Archive },
  { key: 'recent', label: 'Recent', icon: Clock },
  { key: 'png', label: 'PNG', icon: Image },
  { key: 'vector', label: 'Vector', icon: Shapes },
];

interface SearchLinkButtonsProps {
  links: CreatorSearchLinks;
  compact?: boolean;
}

/**
 * Buttons that open Adobe's own stock.adobe.com search pages for a creator in
 * a new tab. The URLs are generated server-side (never fetched), so this works
 * with zero credentials.
 */
export function SearchLinkButtons({ links, compact }: SearchLinkButtonsProps) {
  return (
    <Card className={compact ? 'border-border/70' : undefined}>
      <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-sm font-semibold tracking-tight">Open results on Adobe Stock</h3>
            <p className="text-xs text-muted-foreground">
              Opens Adobe's own search page for contributor #{links.creatorId} in a new tab.
            </p>
          </div>
          <Button asChild variant="default" size="sm">
            <a href={links.viewUrl} target="_blank" rel="noreferrer">
              <ExternalLink />
              View on Adobe Stock
            </a>
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTER_BUTTONS.map(({ key, label, icon: Icon }) => (
            <Button asChild key={key} variant="outline" size="sm">
              <a
                href={links.filters[key]}
                target="_blank"
                rel="noreferrer"
                title={`Open "${label}" results on Adobe Stock`}
              >
                <Icon />
                {label}
              </a>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
