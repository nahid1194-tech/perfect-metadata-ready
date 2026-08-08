import type { Asset, LicenseHistoryEntry } from '@/types';

/**
 * CSV columns per product spec: Asset ID, Title, Creator, Creator ID,
 * Content Type, Keywords, Thumbnail URL, Adobe URL, Historical metric,
 * First Seen, Last Seen.
 */
const CSV_HEADER = [
  'Asset ID',
  'Title',
  'Creator',
  'Creator ID',
  'Content Type',
  'Keywords',
  'Thumbnail URL',
  'Adobe URL',
  'Historical metric',
  'First Seen',
  'Last Seen',
];

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCell(value: string | null | undefined, fallback = ''): string {
  return csvEscape(value === null || value === undefined ? fallback : value);
}

/**
 * Human-friendly description of the most meaningful historical metric the
 * asset has, so exports never mislabel a popularity signal as a download count.
 */
function metricCell(asset: Asset): string {
  if (asset.downloads !== null) return `Exact downloads: ${asset.downloads}`;
  if (asset.popularity) {
    return `Popularity signal: ${asset.popularity.percentile.toFixed(1)}% (rank ${asset.popularity.rank}/${asset.popularity.total})`;
  }
  if (asset.observationCount && asset.observationCount > 0) return `Observed ${asset.observationCount}x, no numeric metric`;
  return 'Exact downloads unavailable';
}

/** Export the given assets as a CSV file downloaded into the browser. */
export function exportAssetsCsv(assets: Asset[], query: string): void {
  const rows = assets.map((asset) => {
    const keywords =
      asset.keywords === null || asset.keywords.length === 0
        ? 'unavailable'
        : asset.keywords.join('; ');
    return [
      asset.id,
      toCell(asset.title),
      toCell(asset.creatorName),
      asset.creatorId,
      asset.contentType,
      csvEscape(keywords),
      toCell(asset.thumbnail),
      toCell(asset.assetUrl),
      metricCell(asset),
      toCell(asset.firstSeenAt),
      toCell(asset.lastSeenAt),
    ].join(',');
  });

  const csv = [CSV_HEADER.join(','), ...rows].join('\r\n');
  downloadCsv(csv, `adobe-stock-${safeFilename(query) || 'assets'}.csv`);
}

const LICENSE_HISTORY_HEADER = [
  'Asset ID',
  'Title',
  'Creator ID',
  'Creator Name',
  'Content Type',
  'License Type',
  'License Date',
  'Thumbnail URL',
  'Adobe URL',
];

/** Export the authenticated account's license history as a CSV file. */
export function exportLicenseHistoryCsv(entries: LicenseHistoryEntry[]): void {
  const rows = entries.map((entry) =>
    [
      entry.assetId,
      toCell(entry.title),
      toCell(entry.creatorId),
      toCell(entry.creatorName),
      toCell(entry.contentType),
      toCell(entry.licenseType),
      toCell(entry.licenseDateRaw ?? entry.licenseDate),
      toCell(entry.thumbnailUrl),
      toCell(entry.detailsUrl),
    ].join(','),
  );
  const csv = [LICENSE_HISTORY_HEADER.join(','), ...rows].join('\r\n');
  downloadCsv(csv, 'adobe-stock-license-history.csv');
}

function safeFilename(value: string): string {
  return value.trim().replace(/[^\w-]+/g, '_').slice(0, 40);
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
