import { Ban, Clock, Loader2, WifiOff } from 'lucide-react';

import type { SourceStatus } from '@/types';

interface SourceBannerProps {
  source: SourceStatus;
  message: string;
}

const CONFIG: Record<string, { icon: React.ReactNode; className: string }> = {
  blocked: { icon: <Ban className="size-4 shrink-0" />, className: 'border-amber-300 bg-amber-50 text-amber-900' },
  unavailable: { icon: <Ban className="size-4 shrink-0" />, className: 'border-amber-300 bg-amber-50 text-amber-900' },
  rate_limited: { icon: <Clock className="size-4 shrink-0" />, className: 'border-amber-300 bg-amber-50 text-amber-900' },
  timeout: { icon: <Clock className="size-4 shrink-0" />, className: 'border-red-300 bg-red-50 text-red-900' },
  error: { icon: <WifiOff className="size-4 shrink-0" />, className: 'border-red-300 bg-red-50 text-red-900' },
};

export function SourceBanner({ source, message }: SourceBannerProps) {
  const fallback = { icon: <Ban className="size-4 shrink-0" />, className: 'border-amber-300 bg-amber-50 text-amber-900' };
  const config = CONFIG[source] ?? fallback;
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border p-3.5 text-sm ${config.className}`}>
      {config.icon}
      <div className="space-y-1">
        <p className="font-medium">Adobe Stock data is currently unavailable</p>
        <p className="text-xs opacity-90">{message}</p>
      </div>
    </div>
  );
}

export function LoadingBanner() {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 p-3.5 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Loading contributor data…
    </div>
  );
}
