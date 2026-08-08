import { useState } from 'react';
import { Download, ExternalLink, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { exportAssetsCsv } from '@/lib/csv';
import type { Asset, AssetSearchFilter, AssetSearchSort } from '@/types';

const SORT_OPTIONS: ReadonlyArray<{ value: AssetSearchSort; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'downloads', label: 'Most downloaded' },
  { value: 'newest', label: 'Newest' },
  { value: 'undiscovered', label: 'Undiscovered' },
];

const FILTER_OPTIONS: ReadonlyArray<{ value: AssetSearchFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'photo', label: 'Photo' },
  { value: 'illustration', label: 'Illustration' },
  { value: 'vector', label: 'Vector' },
  { value: 'transparent', label: 'PNG · Transparent' },
  { value: 'video', label: 'Video' },
  { value: 'template', label: 'Template' },
  { value: '3d', label: '3D' },
  { value: 'ai', label: 'Generative AI' },
];

interface AssetSearchToolbarProps {
  query: string;
  total: number | null;
  assets: Asset[];
  sort: AssetSearchSort;
  onSortChange: (sort: AssetSearchSort) => void;
  filter: AssetSearchFilter;
  onFilterChange: (filter: AssetSearchFilter) => void;
  viewUrl: string | null;
  onRefresh: () => void;
}

export function AssetSearchToolbar({
  query,
  total,
  assets,
  sort,
  onSortChange,
  filter,
  onFilterChange,
  viewUrl,
  onRefresh,
}: AssetSearchToolbarProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = assets.length > 0 && selected.size === assets.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(assets.map((a) => a.id)));
    }
  };

  const exportSelected = () => {
    const rows = selected.size > 0 ? assets.filter((a) => selected.has(a.id)) : assets;
    exportAssetsCsv(rows, query);
  };

  const resultLabel =
    total === null
      ? `${assets.length} result${assets.length === 1 ? '' : 's'} loaded`
      : `${total.toLocaleString()} result${total === 1 ? '' : 's'}`;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">
          {resultLabel} <span className="text-muted-foreground">for “{query}”</span>
          {selected.size > 0 && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {selected.size} selected
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className={viewUrl === null ? 'pointer-events-none opacity-50' : undefined}
          >
            <a href={viewUrl ?? undefined} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open on Adobe Stock
            </a>
          </Button>
          <Button variant="outline" size="sm" disabled={assets.length === 0} onClick={toggleSelectAll}>
            {allSelected ? 'Deselect all' : 'Select all'}
          </Button>
          <Button variant="outline" size="sm" disabled={assets.length === 0} onClick={exportSelected}>
            <Download />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RotateCcw />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border/70 pt-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-full text-xs font-medium tracking-wide text-muted-foreground uppercase lg:w-auto">
            Content type
          </span>
          {FILTER_OPTIONS.map(({ value, label }) => (
            <Button
              key={value}
              variant={filter === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => onFilterChange(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Sort</span>
          <Select value={sort} onValueChange={(value) => onSortChange(value as AssetSearchSort)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
