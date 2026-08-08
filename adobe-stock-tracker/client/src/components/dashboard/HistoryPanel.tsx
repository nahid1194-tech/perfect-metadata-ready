import { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, History, Minus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCount } from '@/lib/utils';
import { useHistory } from '@/hooks/useHistory';
import type { HistoryRange } from '@/types';

const RANGE_OPTIONS: ReadonlyArray<{ value: HistoryRange; label: string }> = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];

interface HistoryPanelProps {
  assetId: string | null;
}

/** Simple dependency-free SVG line chart for observation values. */
function TrendChart({ values }: { values: Array<{ label: string; value: number }> }) {
  const width = 600;
  const height = 180;
  const pad = 8;

  const path = useMemo(() => {
    if (values.length < 2) return null;
    const min = Math.min(...values.map((p) => p.value));
    const max = Math.max(...values.map((p) => p.value));
    const span = max - min || 1;
    const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
    const points = values.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
    const last = values[values.length - 1] as { label: string; value: number };
    return { polyline: points.join(' '), lastX: x(values.length - 1), lastY: y(last.value) };
  }, [values, width, height]);

  if (!path) {
    return <p className="py-6 text-center text-xs text-muted-foreground">Not enough data points to plot yet.</p>;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full" role="img" aria-label="Metric trend chart">
      <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} className="stroke-border" strokeWidth={1} />
      <line x1={pad} x2={pad} y1={pad} y2={height - pad} className="stroke-border" strokeWidth={1} />
      <polyline points={path.polyline} fill="none" strokeWidth={2} className="stroke-primary" />
      <circle cx={path.lastX} cy={path.lastY} r={3.5} className="fill-primary" />
    </svg>
  );
}

function ChangeStat({
  label,
  value,
  delta,
  deltaPercent,
}: {
  label: string;
  value: number | null;
  delta?: number | null;
  deltaPercent?: number | null;
}) {
  const positive = delta !== undefined && delta !== null && delta > 0;
  const negative = delta !== undefined && delta !== null && delta < 0;

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tracking-tight tabular-nums">{value === null ? '—' : formatCount(value)}</p>
      <div className="flex items-center gap-1.5 text-xs">
        {delta === undefined ? (
          <span className="text-muted-foreground">at start of range</span>
        ) : delta === null ? (
          <>
            <Minus className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">No prior data</span>
          </>
        ) : positive ? (
          <>
            <ArrowUpRight className="size-3.5 text-emerald-600" />
            <span className="text-emerald-600">
              +{formatCount(delta)} ({deltaPercent?.toFixed(1)}%)
            </span>
          </>
        ) : negative ? (
          <>
            <ArrowDownRight className="size-3.5 text-red-600" />
            <span className="text-red-600">
              {formatCount(delta)} ({deltaPercent?.toFixed(1)}%)
            </span>
          </>
        ) : (
          <>
            <Minus className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">No change</span>
          </>
        )}
      </div>
    </div>
  );
}

export function HistoryPanel({ assetId }: HistoryPanelProps) {
  const { range, changeRange, history, phase, error } = useHistory(assetId);

  const numericPoints = (history?.points ?? []).filter(
    (p): p is (typeof p & { value: number }) => typeof p.value === 'number',
  );
  const chartValues = numericPoints.map((p) => ({
    label: new Date(p.observedAt).toLocaleDateString(),
    value: p.value,
  }));

  const loading = phase === 'loading' && !history;

  return (
    <Card className="border-border/70">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Historical trend</h3>
            {history && (
              <Badge variant="secondary" className="text-[10px] font-normal">
                {history.metricLabel}
              </Badge>
            )}
          </div>
          <Select value={range} onValueChange={(value) => changeRange(value as HistoryRange)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading && <Skeleton className="h-44 w-full" />}

        {error && <p className="text-sm text-destructive">{error.message}</p>}

        {!loading && !error && (
          <>
            {history?.metricLabel && (
              <p className="text-[11px] text-muted-foreground">
                {history.metricLabel === 'Exact downloads'
                  ? 'Exact download counts from an authorized data source.'
                  : 'Ranking-derived popularity signal — not a real download count.'}
                {history.notice ? ` ${history.notice}` : ''}
              </p>
            )}
            <TrendChart values={chartValues} />
            <div className="grid grid-cols-3 gap-3 border-t border-border/70 pt-3">
              <ChangeStat
                label="Current"
                value={history?.current ?? null}
                delta={history?.change ?? null}
                deltaPercent={history?.changePercent ?? null}
              />
              <ChangeStat label="Previous" value={history?.previous ?? null} />
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Range</p>
                <p className="text-lg font-semibold tracking-tight tabular-nums">{history?.points.length ?? 0}</p>
                <p className="text-xs text-muted-foreground">observations</p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
