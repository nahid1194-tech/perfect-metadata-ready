import { ExternalLink, Unplug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { CreatorSearchLinks } from '@/types';

interface ApiNotConnectedProps {
  links: CreatorSearchLinks;
}

/**
 * Shown when no official Adobe Stock API credentials are configured. The
 * dashboard runs in search-link mode: it never fetches data and never
 * fabricates numbers — it only opens Adobe's own search pages.
 */
export function ApiNotConnected({ links }: ApiNotConnectedProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-2.5">
        <Unplug className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">API not connected — search-link mode is active</p>
          <p className="text-xs opacity-90">
            No Adobe Stock API credentials are configured, so live asset data can't be shown. The dashboard is
            generating official stock.adobe.com search links for contributor #{links.creatorId} — use the buttons below
            to open Adobe's own result pages in a new tab. Add a free Adobe Stock API key to enable the full dashboard.
          </p>
        </div>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0 bg-white/60">
        <a href={links.viewUrl} target="_blank" rel="noreferrer">
          <ExternalLink />
          View on Adobe Stock
        </a>
      </Button>
    </div>
  );
}
