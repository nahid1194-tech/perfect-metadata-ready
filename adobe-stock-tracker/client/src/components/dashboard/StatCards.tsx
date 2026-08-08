import { Archive, BarChart3, Download, Layers } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatCount } from '@/lib/utils';
import type { CreatorStats } from '@/types';

interface StatCardsProps {
  stats: CreatorStats | null;
  loading: boolean;
}

interface StatCardData {
  label: string;
  value: number | null;
  icon: React.ReactNode;
  note?: string;
  highlight?: boolean;
}

export function StatCards({ stats, loading }: StatCardsProps) {
  const items: StatCardData[] = [
    {
      label: 'Total Assets',
      value: stats?.totalAssets ?? null,
      icon: <Layers className="size-4" />,
    },
    {
      label: 'Downloaded Assets',
      value: stats?.downloadedAssets ?? null,
      icon: <Download className="size-4" />,
      highlight: true,
    },
    {
      label: 'Undownloaded Assets',
      value: stats?.undownloadedAssets ?? null,
      icon: <Archive className="size-4" />,
    },
    {
      label: 'Total Downloads',
      value: stats?.totalDownloads ?? null,
      icon: <BarChart3 className="size-4" />,
      note: stats?.totalDownloadsIsPartial ? 'based on loaded data' : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} className="border-border/70">
          <CardContent className="flex items-start justify-between gap-2 p-4">
            <div className="min-w-0 space-y-1">
              <p className="truncate text-xs font-medium text-muted-foreground">{item.label}</p>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p
                  className={cn(
                    'text-2xl font-semibold tracking-tight tabular-nums',
                    item.value === null && 'text-muted-foreground',
                    item.highlight && item.value !== null && 'text-primary',
                  )}
                >
                  {item.value === null ? '—' : formatCount(item.value)}
                </p>
              )}
              {item.note && <p className="text-[11px] text-muted-foreground">{item.note}</p>}
              {!loading && item.value === null && !item.note && (
                <p className="text-[11px] text-muted-foreground">not exposed by source</p>
              )}
            </div>
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              {item.icon}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
