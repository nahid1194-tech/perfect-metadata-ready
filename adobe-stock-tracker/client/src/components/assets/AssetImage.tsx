import { useState } from 'react';
import { ImageOff } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface AssetImageProps {
  src: string | null;
  alt: string;
  className?: string;
}

export function AssetImage({ src, alt, className }: AssetImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className={cn('relative overflow-hidden bg-muted', className)}>
      {!loaded && !failed && <Skeleton className="absolute inset-0 rounded-none" />}
      {failed ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <ImageOff className="size-6" />
        </div>
      ) : (
        src !== null && (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={cn(
              'h-full w-full object-cover transition-opacity duration-150',
              loaded ? 'opacity-100' : 'opacity-0',
            )}
          />
        )
      )}
    </div>
  );
}
