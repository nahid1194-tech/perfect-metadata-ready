import { useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface PaginationBarProps {
  /** 1-based current page. */
  page: number;
  /** Total matching results; null when the source does not expose it. */
  total: number | null;
  pageSize: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}

/**
 * Numbered pagination for paged API results: Previous / Next, "Page X of Y"
 * (with a direct page-input jump), and a "Showing X–Y of TOTAL" summary.
 * Replaces the old append-only "Load more" button.
 */
export function PaginationBar({ page, total, pageSize, loading, onPageChange }: PaginationBarProps) {
  const [draft, setDraft] = useState('');

  const totalPages = total === null ? null : Math.max(1, Math.ceil(total / pageSize));
  const from = total !== null && total > 0 ? (page - 1) * pageSize + 1 : 0;
  const to = total !== null ? Math.min(page * pageSize, total) : 0;

  const go = (target: number) => {
    if (!Number.isInteger(target) || target < 1) return;
    if (totalPages !== null && target > totalPages) return;
    onPageChange(target);
  };

  const jump = () => {
    const value = Number.parseInt(draft, 10);
    if (Number.isNaN(value)) return;
    go(value);
    setDraft('');
  };

  return (
    <div className="flex flex-col items-center gap-2 pt-2">
      <p className="text-xs text-muted-foreground">
        {total === null ? (
          `${page > 0 ? page : 1} page${page === 1 ? '' : 's'} loaded`
        ) : (
          <>
            Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} results
          </>
        )}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={loading || page <= 1}
          onClick={() => go(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft />
          Previous
        </Button>

        <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          Page {page}
          {totalPages !== null ? ` of ${totalPages.toLocaleString()}` : ''}
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={loading || (totalPages !== null && page >= totalPages)}
          onClick={() => go(page + 1)}
          aria-label="Next page"
        >
          {loading ? <Loader2 className="animate-spin" /> : <ChevronRight />}
          Next
        </Button>

        {totalPages !== null && totalPages > 1 && (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              jump();
            }}
          >
            <Input
              type="number"
              min={1}
              max={totalPages}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Page"
              className="h-8 w-20 text-xs"
              aria-label="Jump to page"
            />
            <Button type="submit" variant="outline" size="sm" disabled={loading || draft.trim() === ''}>
              Go
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
