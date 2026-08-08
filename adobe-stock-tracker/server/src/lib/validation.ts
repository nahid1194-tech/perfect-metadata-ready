import { ApiError } from '../middleware/error';
import type {
  AssetSearchFilter,
  AssetSearchSort,
  ContentTypeFilter,
  FilterOption,
  SortOption,
} from '../services/adobeStock/adobeStockTypes';

const FILTERS: FilterOption[] = ['all', 'downloaded', 'undiscovered', 'recent', 'transparent', 'vector'];
const SORTS: SortOption[] = ['downloads-desc', 'downloads-asc', 'creation-desc', 'creation-asc'];
const CONTENT_TYPES: ContentTypeFilter[] = ['all', 'photo', 'illustration', 'vector', 'video', 'template', '3d'];
const ASSET_FILTERS: AssetSearchFilter[] = [
  'all',
  'photo',
  'illustration',
  'vector',
  'transparent',
  'video',
  'template',
  '3d',
  'ai',
];
const ASSET_SORTS: AssetSearchSort[] = ['relevance', 'downloads', 'newest', 'undiscovered'];
const HISTORY_RANGES = ['7d', '30d', '90d', 'all'] as const;

const SEARCH_QUERY_MAX_LENGTH = 300;

/** Adobe contributor IDs are numeric. Allow digits plus a small safe set. */
const CREATOR_ID_PATTERN = /^[0-9]{1,24}$/;

export function validateCreatorId(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) {
    throw new ApiError(400, 'INVALID_CREATOR_ID', 'Creator ID is required.');
  }
  if (!CREATOR_ID_PATTERN.test(value)) {
    throw new ApiError(400, 'INVALID_CREATOR_ID', 'Creator ID must be a numeric Adobe Stock contributor ID.');
  }
  return value;
}

/** Adobe Stock media IDs are numeric. */
export function validateAssetId(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) {
    throw new ApiError(400, 'INVALID_ASSET_ID', 'Asset ID is required.');
  }
  if (!CREATOR_ID_PATTERN.test(value)) {
    throw new ApiError(400, 'INVALID_ASSET_ID', 'Asset ID must be a numeric Adobe Stock asset (media) ID.');
  }
  return value;
}

export function validateSearchQuery(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) {
    throw new ApiError(400, 'INVALID_QUERY', 'A search phrase is required.');
  }
  if (value.length > SEARCH_QUERY_MAX_LENGTH) {
    throw new ApiError(400, 'INVALID_QUERY', `Search phrase must be at most ${SEARCH_QUERY_MAX_LENGTH} characters.`);
  }
  return value;
}

/** Optional free-text filter (used by License History search). */
export function validateOptionalSearchQuery(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = raw.trim();
  if (value.length > SEARCH_QUERY_MAX_LENGTH) {
    throw new ApiError(400, 'INVALID_QUERY', `Search phrase must be at most ${SEARCH_QUERY_MAX_LENGTH} characters.`);
  }
  return value;
}

/** Optional ISO date (YYYY-MM-DD) used for license-date filtering. */
export function validateOptionalIsoDate(raw: string | undefined, name: string): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, 'INVALID_QUERY', `${name} must be a date in YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, 'INVALID_QUERY', `${name} is not a valid date.`);
  }
  return value;
}

export function parsePositiveInt(raw: string | undefined, name: string, fallback: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new ApiError(400, 'INVALID_QUERY', `${name} must be an integer between 1 and ${max}.`);
  }
  return value;
}

export function parseEnum<T extends string>(raw: string | undefined, allowed: readonly T[], name: string, fallback: T): T {
  if (raw === undefined || raw === '') return fallback;
  const value = raw.toLowerCase();
  if (!allowed.includes(value as T)) {
    throw new ApiError(400, 'INVALID_QUERY', `Invalid ${name}. Allowed: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export const validators = {
  filter: (raw: string | undefined) => parseEnum(raw, FILTERS, 'filter', 'all'),
  sort: (raw: string | undefined) => parseEnum(raw, SORTS, 'sort', 'downloads-desc'),
  contentType: (raw: string | undefined) => parseEnum(raw, CONTENT_TYPES, 'contentType', 'all'),
  assetFilter: (raw: string | undefined) => parseEnum(raw, ASSET_FILTERS, 'filter', 'all'),
  assetSort: (raw: string | undefined) => parseEnum(raw, ASSET_SORTS, 'sort', 'relevance'),
  historyRange: (raw: string | undefined) => parseEnum(raw, HISTORY_RANGES, 'range', '30d'),
  page: (raw: string | undefined) => parsePositiveInt(raw, 'page', 1, 100000),
  limit: (raw: string | undefined) => parsePositiveInt(raw, 'limit', 100, 100),
};
