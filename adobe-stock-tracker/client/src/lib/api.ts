import {
  ApiError,
  type AssetHistoryResult,
  type AssetLinksResponse,
  type AssetMetadataResponse,
  type AssetQuery,
  type AssetSearchLinks,
  type AssetSearchResponse,
  type AssetSearchFilter,
  type AssetSearchSort,
  type CreatorAssetsResponse,
  type CreatorAvailabilityResponse,
  type CreatorOverviewResponse,
  type CreatorSearchLinks,
  type CreatorStats,
  type HistoryRange,
  type KeywordAnalyticsResponse,
  type LicenseHistoryResponse,
  type SettingsResponse,
  type SummaryResponse,
  type TestConnectionResponse,
} from '@/types';

const BASE = '/api';

interface RequestOptions {
  signal?: AbortSignal;
  method?: string;
  body?: string;
}

async function request<T>(path: string, init?: RequestOptions | AbortSignal): Promise<T> {
  const options: RequestOptions = init instanceof AbortSignal ? { signal: init } : (init ?? {});

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      body: options.body,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiError('NETWORK', 'Could not reach the server. Is the backend running?');
  }

  if (!response.ok) {
    let body: { error?: { code?: string; message?: string } } | null = null;
    try {
      body = (await response.json()) as { error?: { code?: string; message?: string } };
    } catch {
      body = null;
    }
    throw new ApiError(
      body?.error?.code ?? 'HTTP_ERROR',
      body?.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

export function fetchCreatorAssets(creatorId: string, query: AssetQuery, signal?: AbortSignal): Promise<CreatorAssetsResponse> {
  const params = new URLSearchParams({ creatorId });
  if (query.filter) params.set('filter', query.filter);
  if (query.sort) params.set('sort', query.sort);
  if (query.contentType) params.set('contentType', query.contentType);
  if (query.page) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return request<CreatorAssetsResponse>(`/adobe/search${qs ? `?${qs}` : ''}`, signal);
}

export function fetchCreatorStats(creatorId: string, signal?: AbortSignal): Promise<CreatorStats> {
  return request<CreatorStats>(`/creator/${encodeURIComponent(creatorId)}/stats`, signal);
}

export function fetchCreatorSearchLinks(creatorId: string, signal?: AbortSignal): Promise<CreatorSearchLinks> {
  return request<CreatorSearchLinks>(`/creator/${encodeURIComponent(creatorId)}/links`, signal);
}

export function fetchAssetSearchLinks(query: string, signal?: AbortSignal): Promise<AssetSearchLinks> {
  return request<AssetSearchLinks>(`/search/links?q=${encodeURIComponent(query)}`, signal);
}

export function fetchAssetSearch(
  query: string,
  options: { filter?: AssetSearchFilter; sort?: AssetSearchSort; page?: number; limit?: number },
  signal?: AbortSignal,
): Promise<AssetSearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (options.filter) params.set('filter', options.filter);
  if (options.sort) params.set('sort', options.sort);
  if (options.page) params.set('page', String(options.page));
  if (options.limit) params.set('limit', String(options.limit));
  const qs = params.toString();
  return request<AssetSearchResponse>(`/search/assets?${qs}`, signal);
}

export function fetchSimilarAssets(
  assetId: string,
  options: { filter?: AssetSearchFilter; sort?: AssetSearchSort; page?: number; limit?: number },
  signal?: AbortSignal,
): Promise<AssetSearchResponse> {
  const params = new URLSearchParams({ assetId });
  if (options.filter) params.set('filter', options.filter);
  if (options.sort) params.set('sort', options.sort);
  if (options.page) params.set('page', String(options.page));
  if (options.limit) params.set('limit', String(options.limit));
  const qs = params.toString();
  return request<AssetSearchResponse>(`/adobe/similar${qs ? `?${qs}` : ''}`, signal);
}

export function fetchAssetMetadata(assetId: string, signal?: AbortSignal): Promise<AssetMetadataResponse> {
  return request<AssetMetadataResponse>(`/assets/${encodeURIComponent(assetId)}`, signal);
}

export function fetchAssetHistory(assetId: string, range: HistoryRange, signal?: AbortSignal): Promise<AssetHistoryResult> {
  return request<AssetHistoryResult>(`/assets/${encodeURIComponent(assetId)}/history?range=${range}`, signal);
}

export function fetchAssetLinks(assetId: string, signal?: AbortSignal): Promise<AssetLinksResponse> {
  return request<AssetLinksResponse>(`/assets/${encodeURIComponent(assetId)}/links`, signal);
}

export function fetchSummary(signal?: AbortSignal): Promise<SummaryResponse> {
  return request<SummaryResponse>('/analytics/summary', signal);
}

export function fetchKeywordAnalytics(limit = 50, signal?: AbortSignal): Promise<KeywordAnalyticsResponse> {
  return request<KeywordAnalyticsResponse>(`/analytics/keywords?limit=${limit}`, signal);
}

export function fetchCreatorOverview(creatorId: string, limit = 50, signal?: AbortSignal): Promise<CreatorOverviewResponse> {
  return request<CreatorOverviewResponse>(`/creator/${encodeURIComponent(creatorId)}/overview?limit=${limit}`, signal);
}

export function fetchCreatorAvailability(creatorId: string, signal?: AbortSignal): Promise<CreatorAvailabilityResponse> {
  return request<CreatorAvailabilityResponse>(`/creator/${encodeURIComponent(creatorId)}/availability`, signal);
}

export function fetchLicenseHistory(
  options: { query?: string; from?: string; to?: string; page?: number; limit?: number },
  signal?: AbortSignal,
): Promise<LicenseHistoryResponse> {
  const params = new URLSearchParams();
  if (options.query) params.set('query', options.query);
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  if (options.page) params.set('page', String(options.page));
  if (options.limit) params.set('limit', String(options.limit));
  const qs = params.toString();
  return request<LicenseHistoryResponse>(`/license-history${qs ? `?${qs}` : ''}`, signal);
}

export function fetchSettings(signal?: AbortSignal): Promise<SettingsResponse> {
  return request<SettingsResponse>('/settings', signal);
}

export function testApiConnection(signal?: AbortSignal): Promise<TestConnectionResponse> {
  return request<TestConnectionResponse>('/settings/test-connection', { method: 'POST', signal });
}
