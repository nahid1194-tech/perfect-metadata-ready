import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface LoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  shown: number;
  total: number | null;
  onLoadMore: () => void;
}

export function LoadMore({ hasMore, loading, shown, total, onLoadMore }: LoadMoreProps) {
  return (
    <div className="flex flex-col items-center gap-2 pt-2">
      <p className="text-xs text-muted-foreground">
        Showing {shown} asset{shown === 1 ? '' : 's'}
        {total !== null ? ` of ${total.toLocaleString()}` : ''}
      </p>
      {hasMore && (
        <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="animate-spin" />
              Loading more…
            </>
          ) : (
            <>
              <RefreshCw />
              Load more
            </>
          )}
        </Button>
      )}
    </div>
  );
}
