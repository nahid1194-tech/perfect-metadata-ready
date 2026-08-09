import { ExternalLink, Unplug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { CreatorSearchLinks } from '@/types';

interface ApiNotConnectedProps {
  links: CreatorSearchLinks;
}

/**
 * Shown when ADOBE_STOCK_API_KEY is not configured. Live asset previews
 * cannot be displayed without credentials, so the app shows an honest setup
 * message and falls back to opening Adobe's own search pages — it never
 * fabricates assets.
 */
export function ApiNotConnected({ links }: ApiNotConnectedProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-2.5">
        <Unplug className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">Adobe Stock API is not configured.</p>
          <p className="text-xs opacity-90">
            Configure Adobe Stock API credentials to display asset previews. Set <code>ADOBE_STOCK_API_KEY</code> (a
            free key from developer.adobe.com) in <code>server/.env</code>, then restart the server. Until then, asset
            previews cannot be shown — use the button to open contributor #{links.creatorId} on Adobe&apos;s own site.
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
