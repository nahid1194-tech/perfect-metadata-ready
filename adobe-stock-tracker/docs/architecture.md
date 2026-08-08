# Architecture

```
┌────────────────────────────┐         ┌─────────────────────────────────────┐
│  Vite dev server (:5173)   │  /api   │  Express API (:4000)                 │
│  React + TS + Tailwind     │ ──────► │  routes/creator.ts  (assets/overview)│
│  shadcn/ui components      │         │  routes/search.ts   (keyword search) │
└────────────────────────────┘         │  routes/assets.ts   (asset ID + hist)│
                                        │  routes/analytics.ts(summary/keywords)│
                                        │  routes/licenseHistory.ts(My License)│
                                        │      │                               │
                                        │      ▼                               │
                                        │  services/adobeStock/                │
                                        │  dataProvider (factory)              │
                                        │      │  AdobeStockDataProvider       │
                                        │      ├─ AdobeStockApiProvider (api)  │
                                        │      └─ SearchLinkProvider (link)    │
                                        │      │                               │
                                        │      ▼                               │
                                        │  adobeStockSearchUrlBuilder          │
                                        │    → stock.adobe.com/search URLs     │
                                        │    (generated, opened in browser)    │
                                        │  adobeStockApiClient ─► stock.adobe.io│
                                        │  (official Search/Files API)         │
                                        │  (official LicenseHistory API)       │
                                        │  stats.ts (capability-aware stats)   │
                                        │  services/history/ (observations)    │
                                        │    ├─ historicalDataProvider         │
                                        │    ├─ historyStore (Prisma)          │
                                        │    └─ MemoryStore (session-only)     │
                                        │  services/scheduler.ts (bg job)      │
                                        └─────────────────────────────────────┘
```

## Three search modes

The dashboard has three search types — **Creator** (numeric Creator ID), **Asset ID** (numeric media ID, single-asset lookup), and **Title / Keyword** (free-text phrase) — and each runs in one of two provider modes, decided by which provider the factory returns:

- **link mode** (`SearchLinkProvider`, the default without credentials) — the dashboard never fetches data. For a creator it calls `buildCreatorSearchLinks(creatorId)` to generate `https://stock.adobe.com/search?creator_id=…` URLs (Downloaded / Undownloaded / Recent / PNG / Vector); for a keyword search it calls `buildAssetSearchLinks(query)` to generate `…/search?k=<query>` URLs (Relevance / Most downloaded / Newest / Undiscovered sorts + Photo / Illustration / Vector / PNG · Transparent / Video / Template / 3D / AI filters); for an Asset ID it calls `buildAssetIdSearchLink(assetId)` to generate a `k=<assetId>` search URL. All open Adobe's own pages in the user's browser. Zero credentials required; nothing is fabricated.
- **api mode** (`AdobeStockApiProvider`, when an Adobe API key is set) — the full in-app dashboard backed by the official Adobe Stock Search API. Keyword search calls `searchAssets(params)` (word search); Asset ID calls `getAssetMetadata(assetId)` / `searchByAssetId(assetId)` using `search_parameters[media_id]`. The same search links are still exposed, so "Open on Adobe Stock" works everywhere.

The factory (`createDataProvider`) auto-selects: empty/unknown `ADOBE_DATA_PROVIDER` → API provider when an Adobe key is set, otherwise the search-link provider. Both implement the same `AdobeStockDataProvider` interface (`mode`, `fetchCreatorAssets`, `buildCreatorSearchLinks`, `searchAssets`, `buildAssetSearchLinks`, `searchByAssetId`, `getAssetMetadata`, `buildAssetIdSearchLink`, `getCreatorAvailability`, `getLicenseHistory`, `capabilities`), so the UI never changes.

## My License History

A separate page ("My License History") shows the **authenticated user's own** licensing history from the official Adobe License History API (`GET https://stock.adobe.io/Rest/Libraries/1/Member/LicenseHistory`). It is strictly personal — never another contributor's download history — and the page says so.

- **Credentials** (`server/.env`): `ADOBE_STOCK_API_KEY` (`x-api-key`) is required to activate the API provider; `ADOBE_STOCK_ACCESS_TOKEN` (an OAuth token, sent as `Authorization: Bearer`) authorizes the account. Without a token the endpoint returns `authorized: false` with a "License History requires an authorized Adobe account…" message; without any credentials (link mode) it returns `authorized: false` with a setup message. **No license history is ever fabricated.**
- **Upstream contract**: Adobe's endpoint supports pagination via `search_parameters[limit]` (1–100) and `search_parameters[offset]` (0-based), an optional `all=true` for organization-wide history, and `result_columns[]` for fields. It cannot filter by text or date server-side.
- **Local filtering + scan cap**: `adobeStockApiClient.buildAdobeStockApiLicenseHistoryUrl({limit, offset})` builds the request, and `adobeStockApiProvider.getLicenseHistory(params)` scans pages sequentially (politely, through the same retry/queue logic), reads `nb_results` on the first page, applies `query`/`from`/`to` locally, then slices the requested page. `ADOBE_LICENSE_HISTORY_MAX_PAGES` (default 10) bounds the scan; when `scanned < total` the response sets `truncated: true` and a notice explains how to reach older entries.
- **Route + UI**: `routes/licenseHistory.ts` exposes `GET /api/license-history` (validated via `validateOptionalSearchQuery` / `validateOptionalIsoDate`); the client `LicenseHistoryPage` (nav item in `Header`) provides search + date window + pagination + CSV export (`exportLicenseHistoryCsv`), plus an amber "not authorized" banner when no authorized account is connected.

## Frontend (`client/`)

- **Stack**: React 18, TypeScript, Vite 6, Tailwind CSS v4 (via `@tailwindcss/vite`, no PostCSS pipeline), shadcn-style UI primitives under `src/components/ui`.
- **Data flow**: `useCreatorAssets` (creator), `useAssetSearch` (keyword/title), and `useAssetIdSearch` (asset ID) hooks drive the three dashboards. Each first resolves the provider mode + search links (`GET /api/creator/:id/links`, `GET /api/search/links?q=`, or `GET /api/assets/:id/links`). In link mode it stops there and renders the search-link panel. In api mode it then fetches assets (or metadata for asset ID) with `AbortController` cancellation, tracking filters/sort, with load-more, refresh, and reset. A `SearchModeTabs` selector switches between the three, and each hook keeps its own state so results survive switching back.
- **History UI**: `SummaryCards` (total / indexed / with-metrics / observations + Refresh), `CreatorOverviewPanel` (name, portfolio link, content-type breakdown, top assets, top keywords, first/last seen), and a per-asset `HistoryPanel` (SVG trend chart, `7d/30d/90d/all` range selector, current vs. previous stats). Every trend value is labeled with its provenance (exact count vs. popularity signal).
- **Link mode UI**: `ApiNotConnected` banner + `SearchLinkButtons` (creator: Downloaded / Undownloaded / Recent / PNG / Vector + "View on Adobe Stock"), `AssetSearchLinksPanel` (keyword: sort + content-type variants + "Open on Adobe Stock"), and the Asset-ID search link button — each is an `<a target="_blank">` opening Adobe's own page.
- **API client**: `src/lib/api.ts` talks to `/api` (proxied to `http://localhost:4000` in dev).
- **States**: every fetch renders one of `LoadingBanner`, `SourceBanner` (blocked/unavailable/…), `DataNote` (informational notes on successful results), `EmptyState`, `ErrorState`, or the asset grid with `LoadMore`. Asset cards show only real metadata (title, asset ID, contributor, keywords, content type, dimensions, category, AI badge); download counts and upload dates display as unavailable when the API does not expose them. Export CSV (`lib/csv.ts`) writes only what the API actually returned, labeling the historical metric column as exact or popularity-signal.

## Backend (`server/`)

- **Stack**: Express 4, TypeScript, `tsx` for dev, `express-rate-limit` for throttling.
- **Routing**: `src/routes/creator.ts` — `GET /api/creator/:creatorId/assets`, `GET /api/creator/:creatorId/stats`, `GET /api/creator/:creatorId/overview`, `GET /api/creator/:creatorId/availability`, and `GET /api/creator/:creatorId/links`. `src/routes/search.ts` — `GET /api/search/links` and `GET /api/search/assets` (both take `q`; the asset endpoint also takes `filter`/`sort`/`page`/`limit`). `src/routes/assets.ts` — `GET /api/assets/:assetId`, `GET /api/assets/:assetId/history`, `GET /api/assets/:assetId/links`. `src/routes/analytics.ts` — `GET /api/analytics/summary` and `GET /api/analytics/keywords`. `src/routes/licenseHistory.ts` — `GET /api/license-history`. Query params are validated in `src/lib/validation.ts`; Creator/Asset IDs must be numeric, search phrases must be 1–300 chars, and license-history dates must be `YYYY-MM-DD`.
- **Data-provider layer** (`src/services/adobeStock/`) — the key design decision. The app never talks to Adobe directly from components; it asks a provider that implements the `AdobeStockDataProvider` interface:
  - `AdobeStockApiProvider` (`mode: "api"`) — calls the **official Adobe Stock Search API** (`GET https://stock.adobe.io/Rest/Media/1/Search/Files`) with the configured API key. It uses documented parameters only and **never scrapes the website and never bypasses Adobe's access controls.** If no API key is configured, its data methods return `source: "unavailable"`.
  - `SearchLinkProvider` (`mode: "link"`) — credential-free. Data methods honestly return `source: "unavailable"` with the "API not connected" message; the link builders produce the site search URLs.
- **Search-link builder** (`adobeStockSearchUrlBuilder.ts`): builds the `stock.adobe.com/search` query strings. Creator links preserve `creator_id`, the common content-type filters, `limit=100`, `search_page=1`, `search_type=pagination`, `get_facets=0` and per-filter extras (`order=nb_downloads`, `order=creation`, `filters[undiscovered]=only`, `filters[transparent]=only`, `filters[content_type:zip_vector]=1`) — matching the reference Chrome extension. Keyword links use the `k=<query>` search parameter with the same `limit`/pagination extras plus sort (`order=relevance|nb_downloads|creation|undiscovered`), content-type filters, and the AI filter (`filters[gentech]=only`). Asset-ID links use `k=<assetId>`. **The backend only generates these URLs; it never fetches them.**
- **Capabilities** (`AdobeStockProviderCapabilities`): each provider declares what it can honestly deliver (`canPartitionDiscovered`, `exposesDownloadCounts`). The stats layer refuses to derive numbers the source can't produce.
- **Normalized types** (`adobeStockTypes.ts`): providers return a provider-agnostic shape (`AdobeStockAsset`, `CreatorAssetsResult`, `CreatorStatsResult`, `CreatorSearchLinks`, `AssetSearchLinks`, `AssetSearchResult`, `CreatorAvailability`, `LicenseHistoryResult`), plus an optional `notice` for honest informational notes. `AdobeStockAsset` also carries `creatorName`, `keywords`, `dimensions`, `category`, `isTransparent`/`isGenerativeAI`, and a `popularity` signal derived from Adobe's ranking order (never a fabricated count).
- **Availability** (`getCreatorAvailability` on every provider): returns per-field honesty — `officialApiAvailable`, plus `downloadData`, `acceptanceData`, `uploadHistory`, `salesHistory` each with a `status` (`available | unavailable | not_provided | not_authorized`) and an explanatory message. The API provider marks everything Adobe does not expose as `not_provided`; link mode marks them `unavailable`. Weekly contributor sales are never shown.
- **Stats** (`stats.ts`): computes `totalAssets` from the API's `nb_results`; leaves `downloadedAssets`, `undownloadedAssets`, and `totalDownloads` as `null` because the official API does not expose per-asset download counts or an undiscovered-only filter.
- **History layer** (`src/services/history/`): `historicalDataProvider.ts` exposes a singleton (`getHistoryProvider()`) over a `HistoryStore`. `historyStore.ts` is the PostgreSQL/Prisma store (used only when `DATABASE_URL` is set); `MemoryStore` in the same file is the session-only fallback. `recorder.ts` records observations with honest provenance — exact counts (`source: "official-api-exact"`) only when `provider.capabilities.exposesDownloadCounts` is true, otherwise a percentile (`source: "popularity-signal"`). Writes are throttled to one point per asset per `OBSERVATION_INTERVAL_MS`.
- **Scheduler** (`src/services/scheduler.ts`): a background job (enabled by default, unref'd timers) re-samples all tracked creators shortly after boot (`OBSERVATION_START_DELAY_MS`) and then every `OBSERVATION_INTERVAL_MS`, so trends build up over time. It runs through the API provider's polite queue.
- **Cache** (`src/lib/cache.ts`): simple in-memory TTL cache used for upstream page responses and stats.
- **Middleware**: `src/middleware/rateLimit.ts` (per-IP window), `src/middleware/error.ts` (`ApiError` + JSON error handler). `app.ts` serves `client/dist` when present so the production server is single-process.

## Upstream request logic

`adobeStockApiClient.ts` builds the official Search/Files query:

- Creator search: `search_parameters[creator_id]` — the contributor to analyze; Keyword search: `search_parameters[words]` — the free-text phrase; Asset ID lookup: `search_parameters[media_id]` — a single media ID (limit 1)
- `search_parameters[order]` — `nb_downloads`, `creation`, `undiscovered`, or `relevance` (Adobe performs the ranking; the API supports only descending for the sort orders)
- `search_parameters[filters][content_type:photo|illustration|vector|video|template|3d]=1`
- `search_parameters[filters][transparent]=true` (transparent / PNG tab)
- `search_parameters[filters][gentech]=only` (AI-only tab)
- `search_parameters[filters][premium]=false` (always — works around a documented Adobe pagination bug)
- `search_parameters[offset]`/`[limit]` — pagination (offset starts at 0)
- `result_columns[]` — the fields the dashboard uses (`creator_name`, `keywords`, thumbnail, title, `width`, `height`, `category`, `description`, `is_gentech`, etc.)
- Headers: `x-api-key` (from `ADOBE_STOCK_API_KEY` / `ADOBE_API_CLIENT_ID`), `X-Product`; optional `Authorization: Bearer` (only used by the License History request, from `ADOBE_STOCK_ACCESS_TOKEN` / `ADOBE_API_ACCESS_TOKEN`)
- Politeness: concurrent upstream calls are capped by `ADOBE_REQUEST_CONCURRENCY` (a semaphore), 429/5xx are retried with jittered exponential backoff (`ADOBE_MAX_RETRIES`/`ADOBE_BACKOFF_BASE_MS`), and identical in-flight requests are deduplicated.

The License History request (`buildAdobeStockApiLicenseHistoryUrl`) hits `Rest/Libraries/1/Member/LicenseHistory` with `search_parameters[limit]`/`search_parameters[offset]`, `all=true`, and `result_columns[]` (thumbnail, title, creator, content/media type, license, `license_date`, `download_url`). It uses the same polite transport (`fetchAdobeStockLicenseHistory`).

Because Adobe's API does not return per-asset download counts or creation dates, `downloads`, `createdAt`, and the downloaded/undiscovered partition are shown as unavailable ("—" / "Download count unavailable"), never estimated. `creatorName` and `keywords` are only shown when the API actually returns them. Download *ranking* (`order=nb_downloads`/`undiscovered`) is surfaced honestly as a percentile `popularity` signal with `source: "popularity-signal"`, never as a real count.

## Why "API not connected" instead of fake data?

In link mode the backend never produces numbers — it only returns URLs. In api mode, `AdobeStockApiProvider.fetchCreatorAssets` first checks whether `ADOBE_API_CLIENT_ID` is set; if not, it returns an empty result with `source: "unavailable"`. There is no code path that produces plausible-but-false numbers.
