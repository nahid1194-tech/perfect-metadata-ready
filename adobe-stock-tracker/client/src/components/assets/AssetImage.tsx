import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface AssetImageProps {
  /** Best thumbnail URL (server-resolved priority). */
  src: string | null;
  /** Adobe's 1000px thumbnail URL (preferred tier, tried first). */
  thumbnail1000?: string | null;
  /** Adobe's 500px thumbnail URL (second tier). */
  thumbnail500?: string | null;
  /** Adobe's default thumbnail URL (final fallback tier). */
  thumbnailUrl?: string | null;
  alt: string;
  className?: string;
}

/**
 * Tiered thumbnail renderer. Tries the URLs in the documented priority order
 * (thumbnail_1000_url → thumbnail_500_url → thumbnail_url), falling through to
 * the next tier when an image fails to load. Shows a skeleton while loading
 * and an icon instead of a broken image when every tier fails.
 */
export function AssetImage({ src, thumbnail1000, thumbnail500, thumbnailUrl, alt, className }: AssetImageProps) {
  const tiers = [thumbnail1000 ?? null, thumbnail500 ?? null, src ?? thumbnailUrl ?? null].filter(
    (value): value is string => Boolean(value),
  );

  const [loaded, setLoaded] = useState(false);
  const [failedIndex, setFailedIndex] = useState<number | null>(null);

  // Reset state when the candidate list changes (new asset, new page).
  useEffect(() => {
    setLoaded(false);
    setFailedIndex(null);
  }, [tiers.join('|')]);

  const currentIndex = failedIndex === null ? 0 : Math.min(failedIndex + 1, tiers.length);
  const current = tiers[currentIndex] ?? null;
  const allFailed = current === null;

  return (
    <div className={cn('relative overflow-hidden bg-muted', className)}>
      {!loaded && !allFailed && <Skeleton className="absolute inset-0 rounded-none" />}
      {allFailed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
          <ImageOff className="size-6" />
          <span className="px-2 text-center text-[11px] font-medium">Preview unavailable</span>
        </div>
      ) : (
        <img
          src={current}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (currentIndex < tiers.length - 1) setFailedIndex(currentIndex);
            else setFailedIndex(tiers.length); // all tiers exhausted
          }}
          className={cn(
            'h-full w-full object-cover transition-opacity duration-150',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </div>
  );
}
