import { Activity, Database, Layers, RotateCcw, TrendingUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatCount } from '@/lib/utils';
import type { SummaryResponse } from '@/types';

interface SummaryCardsProps {
  summary: SummaryResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

interface CardData {
  label: string;
  value: number | null;
  icon: React.ReactNode;
  note?: string;
}

export function SummaryCards({ summary, loading, onRefresh }: SummaryCardsProps) {
  const items: CardData[] = [
    {
      label: 'Total Assets',
      value: summary?.totalAssets ?? null,
      icon: <Layers className="size-4" />,
    },
    {
      label: 'Indexed Assets',
      value: summary?.indexedAssets ?? null,
      icon: <Database className="size-4" />,
    },
    {
      label: 'Assets With Available Metrics',
      value: summary?.assetsWithAvailableMetrics ?? null,
      icon: <Activity className="size-4" />,
      note: 'assets with an exact or popularity metric',
    },
    {
      label: 'Total Historical Observations',
      value: summary?.totalObservations ?? null,
      icon: <TrendingUp className="size-4" />,
    },
  ];

  return (
    <section aria-label="Local index summary" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Local index: {summary?.storeLabel ?? '—'}
          {summary?.historyAvailable === false && ' · observations are session-only'}
        </p>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RotateCcw />
          Refresh
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((item) => (
          <Card key={item.label} className="border-border/70">
            <CardContent className="flex items-start justify-between gap-2 p-4">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-xs font-medium text-muted-foreground">{item.label}</p>
                {loading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <p className={cn('text-2xl font-semibold tracking-tight tabular-nums')}>
                    {item.value === null ? '—' : formatCount(item.value)}
                  </p>
                )}
                {item.note && <p className="text-[11px] text-muted-foreground">{item.note}</p>}
              </div>
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {item.icon}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
