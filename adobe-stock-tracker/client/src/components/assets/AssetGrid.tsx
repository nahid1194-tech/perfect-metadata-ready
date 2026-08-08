import { AssetCard } from '@/components/assets/AssetCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { Asset } from '@/types';

export function AssetGrid({ assets }: { assets: Asset[] }) {
  if (assets.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {assets.map((asset) => (
        <AssetCard key={asset.id} asset={asset} />
      ))}
    </div>
  );
}

export function SkeletonGrid({ count = 9 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="space-y-2 rounded-xl border bg-card p-0">
          <Skeleton className="aspect-[4/3] w-full rounded-t-xl rounded-b-none" />
          <div className="space-y-2 p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
