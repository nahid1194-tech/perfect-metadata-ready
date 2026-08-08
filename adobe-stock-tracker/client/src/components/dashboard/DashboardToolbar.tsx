import { ArrowDownUp, Filter, SlidersHorizontal } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ContentTypeFilter, FilterOption, SortOption } from '@/types';

interface DashboardToolbarProps {
  filter: FilterOption;
  sort: SortOption;
  contentType: ContentTypeFilter;
  disabled?: boolean;
  onFilterChange: (filter: FilterOption) => void;
  onSortChange: (sort: SortOption) => void;
  onContentTypeChange: (contentType: ContentTypeFilter) => void;
}

const FILTER_TABS: Array<{ value: FilterOption; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'downloaded', label: 'Downloaded' },
  { value: 'undiscovered', label: 'Undiscovered' },
  { value: 'recent', label: 'Recent' },
  { value: 'transparent', label: 'PNG / Transparent' },
  { value: 'vector', label: 'Vector' },
];

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'downloads-desc', label: 'Downloads: High to Low' },
  { value: 'downloads-asc', label: 'Downloads: Low to High' },
  { value: 'creation-desc', label: 'Newest' },
  { value: 'creation-asc', label: 'Oldest' },
];

const CONTENT_TYPE_OPTIONS: Array<{ value: ContentTypeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'photo', label: 'Photo' },
  { value: 'illustration', label: 'Illustration' },
  { value: 'vector', label: 'Vector' },
  { value: 'video', label: 'Video' },
  { value: 'template', label: 'Template' },
  { value: '3d', label: '3D' },
];

export function DashboardToolbar({
  filter,
  sort,
  contentType,
  disabled,
  onFilterChange,
  onSortChange,
  onContentTypeChange,
}: DashboardToolbarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Filter className="size-3.5" />
          Filters
        </span>
        <Tabs
          value={filter}
          onValueChange={(value) => onFilterChange(value as FilterOption)}
          className="min-w-0 flex-1"
        >
          <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-lg p-1">
            {FILTER_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} disabled={disabled}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <ArrowDownUp className="size-3.5 text-muted-foreground" />
          <Select value={sort} onValueChange={(value) => onSortChange(value as SortOption)} disabled={disabled}>
            <SelectTrigger className="w-56" aria-label="Sort">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-3.5 text-muted-foreground" />
          <Select
            value={contentType}
            onValueChange={(value) => onContentTypeChange(value as ContentTypeFilter)}
            disabled={disabled}
          >
            <SelectTrigger className="w-44" aria-label="Content type">
              <SelectValue placeholder="Content type" />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
