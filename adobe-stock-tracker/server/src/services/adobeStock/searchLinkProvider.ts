import { config } from '../../config';
import {
  buildAssetIdSearchLink,
  buildAssetSearchLinks as buildSiteAssetSearchLinks,
  buildCreatorSearchLinks,
} from './adobeStockSearchUrlBuilder';
import type {
  AdobeStockProviderCapabilities,
  AssetMetadataResult,
  AssetSearchLinks,
  AssetSearchParams,
  AssetSearchResult,
  CreatorAssetsResult,
  CreatorAvailability,
  CreatorSearchLinks,
  FetchCreatorAssetsParams,
  LicenseHistoryParams,
  LicenseHistoryResult,
} from './adobeStockTypes';

const LINK_MODE_MESSAGE =
  'API not connected. Live asset data requires an Adobe Stock API key ' +
  '(set ADOBE_STOCK_API_KEY in server/.env — see README.md). Until then, this ' +
  'dashboard runs in search-link mode: it generates stock.adobe.com search URLs ' +
  'that open Adobe\u2019s own result pages. No data is ever fabricated.';

const LICENSE_HISTORY_MESSAGE =
  'License History requires an authorized Adobe account. In search-link mode no API or OAuth ' +
  'credentials are connected, so licensing data cannot be shown. Set ADOBE_STOCK_API_KEY and ' +
  'ADOBE_STOCK_ACCESS_TOKEN in server/.env — see README.md.';

/**
 * Credential-free provider: generates stock.adobe.com search URLs (for both
 * creator and Asset/Title searches) and opens them in the user's browser.
 *
 * It intentionally implements the same `AdobeStockDataProvider` interface as
 * the official API provider, so the UI stays identical. In this mode the
 * dashboard shows the search-link buttons; the data methods honestly report
 * `source: "unavailable"` (they never fetch from the website and never
 * fabricate numbers).
 */
export class SearchLinkProvider {
  readonly name = 'search-link';
  readonly mode = 'link' as const;

  readonly capabilities: AdobeStockProviderCapabilities = {
    canPartitionDiscovered: false,
    exposesDownloadCounts: false,
  };

  async fetchCreatorAssets(params: FetchCreatorAssetsParams): Promise<CreatorAssetsResult> {
    return {
      creatorId: params.creatorId,
      assets: [],
      total: null,
      page: params.page,
      pageSize: params.limit,
      hasMore: false,
      source: 'unavailable',
      sourceMessage: LINK_MODE_MESSAGE,
      provider: this.name,
    };
  }

  async searchAssets(params: AssetSearchParams): Promise<AssetSearchResult> {
    return {
      query: params.query,
      assets: [],
      total: null,
      page: params.page,
      pageSize: params.limit,
      hasMore: false,
      source: 'unavailable',
      sourceMessage: LINK_MODE_MESSAGE,
      provider: this.name,
    };
  }

  async searchByAssetId(assetId: string): Promise<AssetMetadataResult> {
    return this.getAssetMetadata(assetId);
  }

  async getAssetMetadata(assetId: string): Promise<AssetMetadataResult> {
    return {
      asset: null,
      link: buildAssetIdSearchLink(config.adobeSite.searchBaseUrl, assetId, config.adobeSite.limit),
      source: 'unavailable',
      sourceMessage: LINK_MODE_MESSAGE,
      provider: this.name,
    };
  }

  getCreatorAvailability(): CreatorAvailability {
    return {
      officialApiAvailable: false,
      downloadData: {
        status: 'unavailable',
        message: 'Download data unavailable — the official Adobe Stock API is not connected in search-link mode.',
      },
      acceptanceData: {
        status: 'unavailable',
        message: 'Contributor acceptance data unavailable — no data source is connected in search-link mode.',
      },
      uploadHistory: {
        status: 'unavailable',
        message: 'Upload date unavailable — no data source is connected in search-link mode.',
      },
      salesHistory: {
        status: 'unavailable',
        message: 'Weekly contributor sales unavailable — no data source is connected in search-link mode.',
      },
    };
  }

  async getLicenseHistory(_params: LicenseHistoryParams): Promise<LicenseHistoryResult> {
    return {
      entries: [],
      total: null,
      scanned: 0,
      truncated: false,
      page: 1,
      pageSize: 100,
      hasMore: false,
      authorized: false,
      source: 'unavailable',
      sourceMessage: LICENSE_HISTORY_MESSAGE,
      provider: this.name,
    };
  }

  buildCreatorSearchLinks(creatorId: string): CreatorSearchLinks {
    return buildCreatorSearchLinks({
      baseUrl: config.adobeSite.searchBaseUrl,
      creatorId,
      limit: config.adobeSite.limit,
    });
  }

  buildAssetSearchLinks(query: string): AssetSearchLinks {
    return buildSiteAssetSearchLinks({
      baseUrl: config.adobeSite.searchBaseUrl,
      query,
      limit: config.adobeSite.limit,
    });
  }

  buildAssetIdSearchLink(assetId: string): string {
    return buildAssetIdSearchLink(config.adobeSite.searchBaseUrl, assetId, config.adobeSite.limit);
  }
}
