import { config } from '../../config';
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
  ProviderMode,
} from './adobeStockTypes';
import { AdobeStockApiProvider } from './adobeStockApiProvider';
import { SearchLinkProvider } from './searchLinkProvider';

/**
 * Replaceable data-provider interface.
 *
 * The frontend never talks to Adobe directly. All asset retrieval flows
 * through this interface, so the source can be swapped (official Adobe Stock
 * API, search-link mode, or a compliant alternative later) without touching
 * the UI or routes.
 *
 * `mode` tells the UI how to present the provider:
 *   - "api":  fetchCreatorAssets() returns real asset data.
 *   - "link": the provider only generates stock.adobe.com search URLs
 *     (buildSearchLinks) that are opened in the user's browser. It never
 *     fetches data, so the dashboard shows the search-link UI instead.
 *
 * `buildSearchLinks()` is implemented by every provider — including "api"
 * providers — so the "View on Adobe Stock" buttons always work.
 *
 * `capabilities` declares what a provider can honestly deliver. The stats
 * layer uses it to avoid deriving numbers the source cannot produce.
 */
export interface AdobeStockDataProvider {
  /** Machine-readable provider name, surfaced to the UI. */
  readonly name: string;
  readonly mode: ProviderMode;
  readonly capabilities?: AdobeStockProviderCapabilities;
  fetchCreatorAssets(params: FetchCreatorAssetsParams): Promise<CreatorAssetsResult>;
  /** Keyword (Asset/Title) search over the Adobe Stock catalog. */
  searchAssets(params: AssetSearchParams): Promise<AssetSearchResult>;
  /** Single-asset lookup by media_id (Asset ID search mode). */
  searchByAssetId(assetId: string): Promise<AssetMetadataResult>;
  /** Metadata for one asset (used by the asset detail endpoint). */
  getAssetMetadata(assetId: string): Promise<AssetMetadataResult>;
  buildCreatorSearchLinks(creatorId: string): CreatorSearchLinks;
  /** stock.adobe.com keyword-search URLs (generated, never fetched). */
  buildAssetSearchLinks(query: string): AssetSearchLinks;
  /** stock.adobe.com URL to open a specific Asset ID in the browser. */
  buildAssetIdSearchLink(assetId: string): string;
  /** Per-field availability for the creator dashboard (never guessed). */
  getCreatorAvailability(): CreatorAvailability;
  /**
   * The authenticated account's own license history, from the official Adobe
   * License History API. Returns `authorized: false` (with a clear message)
   * when no authorized account is connected. NEVER represents another
   * contributor's download history.
   */
  getLicenseHistory(params: LicenseHistoryParams): Promise<LicenseHistoryResult>;
}

export function createDataProvider(): AdobeStockDataProvider {
  switch (config.dataProvider) {
    case 'search-link':
    case 'unavailable':
      return new SearchLinkProvider();
    case 'adobe-stock-api':
      return new AdobeStockApiProvider();
    default:
      // Unset (or unknown) value: prefer the official API when credentials
      // exist, otherwise fall back to the credential-free search-link mode.
      return config.adobeApi.clientId
        ? new AdobeStockApiProvider()
        : new SearchLinkProvider();
  }
}
