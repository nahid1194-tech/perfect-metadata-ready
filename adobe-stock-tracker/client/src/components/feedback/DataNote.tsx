import { Info } from 'lucide-react';

interface DataNoteProps {
  notice?: string;
  provider?: string;
}

/**
 * Informational note shown alongside successful results. It surfaces honest
 * details from the data provider, e.g. that the official Adobe Stock API does
 * not expose per-asset download counts.
 */
export function DataNote({ notice, provider }: DataNoteProps) {
  if (!notice) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3.5 text-sm text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        <p>{notice}</p>
        {provider && <p className="text-xs opacity-80">Data source: {provider}</p>}
      </div>
    </div>
  );
}
