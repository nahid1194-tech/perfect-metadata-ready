import { Badge } from '@/components/ui/badge';
import type { AvailabilityStatus, CreatorAvailability } from '@/types';

const STATUS_META: Record<AvailabilityStatus, { label: string; className: string }> = {
  available: { label: 'Available', className: 'border-emerald-600/40 bg-emerald-50 text-emerald-800' },
  unavailable: { label: 'Unavailable', className: 'bg-muted text-muted-foreground' },
  not_provided: { label: 'Not provided', className: 'bg-muted text-muted-foreground' },
  not_authorized: { label: 'Not authorized', className: 'border-amber-600/40 bg-amber-50 text-amber-800' },
};

function AvailabilityRow({ label, status, message }: { label: string; status: AvailabilityStatus; message?: string }) {
  const meta = STATUS_META[status];
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <dt className="shrink-0 text-xs font-medium text-muted-foreground" title={message}>
        {label}
      </dt>
      <dd className="text-right">
        <Badge variant="outline" className={meta.className} title={message}>
          {meta.label}
        </Badge>
      </dd>
    </div>
  );
}

/** Honest per-field data availability for a contributor. Nothing is ever
 * estimated — fields Adobe does not expose are marked Unavailable/Not provided. */
export function CreatorAvailabilityPanel({ availability }: { availability: CreatorAvailability }) {
  return (
    <div className="rounded-lg border border-border/70 p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-semibold">Data availability</p>
        <span className="text-[11px] text-muted-foreground">never estimated</span>
      </div>
      <dl className="space-y-0">
        <AvailabilityRow
          label="Official Adobe Stock API"
          status={availability.officialApiAvailable ? 'available' : 'unavailable'}
          message={availability.officialApiAvailable ? 'Connected to the official Adobe Stock API' : 'Running in link-only mode (no API key)'}
        />
        <AvailabilityRow label="Download data" status={availability.downloadData.status} message={availability.downloadData.message} />
        <AvailabilityRow label="Contributor acceptance data" status={availability.acceptanceData.status} message={availability.acceptanceData.message} />
        <AvailabilityRow label="Upload history" status={availability.uploadHistory.status} message={availability.uploadHistory.message} />
        <AvailabilityRow label="Weekly sales" status={availability.salesHistory.status} message={availability.salesHistory.message} />
      </dl>
    </div>
  );
}
