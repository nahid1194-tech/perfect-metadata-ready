# API Reference

Base URL: `http://localhost:4000` (dev). All responses are JSON.

Errors use this shape (with the matching HTTP status):

```json
{ "error": { "code": "INVALID_QUERY", "message": "..." } }
```

---

## `GET /api/health`

Liveness check.

**Response**

```json
{ "status": "ok", "uptime": 9.1 }
```

---

## `GET /api/adobe/search`

Primary Creator ID search endpoint used by the frontend dashboard. Calls the
official Adobe Stock Search API from the backend (never the browser), then
returns normalized asset data.

### Query parameters

| Name | Type | Default | Allowed |
| --- | --- | --- | --- |
| `creatorId` | string | — | Numeric Adobe Stock contributor ID (required) |
| `filter` | string | `all` | `all`, `downloaded`, `undiscovered`, `recent`, `transparent`, `vector` |
| `sort` | string | `downloads-desc` | `downloads-desc`, `downloads-asc`, `creation-desc`, `creation-asc` |
| `contentType` | string | `all` | `all`, `photo`, `illustration`, `vector`, `video`, `template`, `3d` |
| `page` | int | `1` | `1` – `100000` |
| `limit` | int | `100` | `1` – `100` |

The backend sends `search_parameters[creator_id]`, `limit`, `offset`
(= `(page-1) × limit`) with the `x-api-key` / `x-product` headers; the API key
never reaches the frontend. Successful results are also recorded in the local
history index (same behavior as `/api/creator/:creatorId/assets`).

### Response

Same shape as `/api/creator/:creatorId/assets` (below), i.e.
`{ creatorId, assets, total, page, pageSize, hasMore, source, sourceMessage?, notice?, provider? }`.

---

## `GET /api/creator/:creatorId/assets`

Fetch assets for a numeric Adobe Stock contributor ID.

### Query parameters

| Name | Type | Default | Allowed |
| --- | --- | --- | --- |
| `filter` | string | `all` | `all`, `downloaded`, `undiscovered`, `recent`, `transparent`, `vector` |
| `sort` | string | `downloads-desc` | `downloads-desc`, `downloads-asc`, `creation-desc`, `creation-asc` |
| `contentType` | string | `all` | `all`, `photo`, `illustration`, `vector`, `video`, `template`, `3d` |
| `page` | int | `1` | `1` – `100000` |
| `limit` | int | `100` | `1` – `100` |

Successful responses include `source: "ok"` (or `empty`); asset cards additionally carry honest metadata such as `dimensions`, `category`, `isGenerativeAI`, and a `popularity` signal (see below). Every successful search also records local history: the creator is tracked and each asset gets an observation point (throttled to one per interval per asset).

### Response

```json
{
  "creatorId": "214711383",
  "assets": [
    {
      "id": "…",
      "title": "…",
      "thumbnail": "https://…",
      "assetUrl": "https://…",
      "creatorId": "214711383",
      "contentType": "photo",
      "downloads": null,
      "createdAt": null,
      "status": "unknown"
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 100,
  "hasMore": false,
  "source": "ok",
  "notice": "Official Adobe Stock API. …",
  "provider": "adobe-stock-api"
}
```

Field notes:

- `source` is one of `ok | empty | unavailable | blocked | rate_limited | timeout | error`. When `source` is not `ok`, `assets` is `[]`, `total` is `null`, and `hasMore` is `false`.
- `notice` (when present) is an honest informational note, e.g. that the official API does not expose per-asset download counts.
- `provider` names the data provider that produced the result (`adobe-stock-api` or `search-link`).
- `downloads` and `createdAt` are `null` when the source does not expose them (the official Adobe Stock API does not) — rendered as "—".
- When `ADOBE_STOCK_API_KEY` (alias `ADOBE_API_CLIENT_ID`) is not configured and the API provider is used, `source` is `unavailable` with a setup message. In link mode the endpoint returns the same honest empty shape. **No data is fabricated in any state.**

### Errors

| Status | Code | When |
| --- | --- | --- |
| `400` | `INVALID_CREATOR_ID` | non-numeric or missing `creatorId` |
| `400` | `INVALID_QUERY` | unknown `filter`/`sort`/`contentType`, or `page`/`limit` out of range |
| `429` | `RATE_LIMITED` | too many requests from your IP |

---

## `GET /api/creator/:creatorId/links`

Generated `stock.adobe.com` search URLs for a creator. **Requires no credentials and never fetches from Adobe** — the URLs are opened in the user's browser.

### Response

```json
{
  "creatorId": "214711383",
  "mode": "link",
  "provider": "search-link",
  "base": "https://stock.adobe.com/search?creator_id=214711383&…",
  "viewUrl": "https://stock.adobe.com/search?creator_id=214711383&…",
  "filters": {
    "downloaded": "…&order=nb_downloads&limit=100&…",
    "undownloaded": "…&filters%5Bundiscovered%5D=only&…",
    "recent": "…&order=creation&…",
    "png": "…&filters%5Btransparent%5D=only&…",
    "vector": "…&filters%5Bcontent_type%3Azip_vector%5D=1&…"
  }
}
```

Field notes:

- `mode` is `api` when the official API provider is active, `link` otherwise. The dashboard uses it to decide between the full asset view and the search-link view.
- Every generated URL preserves `creator_id`, the common content-type filters, `limit` (default `100`), `search_page=1`, `search_type=pagination`, and `get_facets=0`.
- The backend only *generates* these URLs; it never requests `stock.adobe.com` itself.

### Errors

| Status | Code | When |
| --- | --- | --- |
| `400` | `INVALID_CREATOR_ID` | non-numeric or missing `creatorId` |
| `429` | `RATE_LIMITED` | too many requests from your IP |

---

## `GET /api/search/links`

Generated `stock.adobe.com` search URLs for an **Asset / Title search**. **Requires no credentials and never fetches from Adobe** — the URLs are opened in the user's browser.

### Query parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `q` | string | yes | Search phrase (max 300 chars) |

### Response

```json
{
  "kind": "asset",
  "query": "pastel",
  "mode": "link",
  "provider": "search-link",
  "base": "https://stock.adobe.com/search?k=pastel&order=relevance&limit=100&search_page=1&search_type=pagination&get_facets=0",
  "viewUrl": "https://stock.adobe.com/search?k=pastel&order=relevance&limit=100&search_page=1&search_type=pagination&get_facets=0",
  "sort": {
    "relevance": "…&order=relevance&…",
    "downloads": "…&order=nb_downloads&…",
    "newest": "…&order=creation&…",
    "undiscovered": "…&order=undiscovered&…"
  },
  "filters": {
    "all": "…",
    "photo": "…&filters%5Bcontent_type%3Aphoto%5D=1&…",
    "illustration": "…&filters%5Bcontent_type%3Aillustration%5D=1&…",
    "vector": "…&filters%5Bcontent_type%3Azip_vector%5D=1&…",
    "transparent": "…&filters%5Btransparent%5D=only&…",
    "video": "…&filters%5Bcontent_type%3Avideo%5D=1&…",
    "template": "…&filters%5Bcontent_type%3Atemplate%5D=1&…",
    "3d": "…&filters%5Bcontent_type%3A3d%5D=1&…",
    "ai": "…&filters%5Bgentech%5D=only&…"
  }
}
```

Field notes:

- `mode` is `api` when the official API provider is active, `link` otherwise.
- Asset search uses Adobe's `k` query parameter on the search page. Every URL preserves `limit` (default `100`), `search_page=1`, `search_type=pagination`, and `get_facets=0`.
- The backend only *generates* these URLs; it never requests `stock.adobe.com` itself.

### Errors

| Status | Code | When |
| --- | --- | --- |
| `400` | `INVALID_QUERY` | missing or empty `q`, or longer than 300 chars |
| `429` | `RATE_LIMITED` | too many requests from your IP |

---

## `GET /api/search/assets`

Fetch assets matching a free-text **Asset / Title search**. Backed by the official Adobe Stock Search API when credentials are configured; otherwise returns the honest empty shape with `source: "unavailable"`.

### Query parameters

| Name | Type | Default | Allowed |
| --- | --- | --- | --- |
| `q` | string | — (required) | 1 – 300 chars |
| `filter` | string | `all` | `all`, `photo`, `illustration`, `vector`, `transparent`, `video`, `template`, `3d`, `ai` |
| `sort` | string | `relevance` | `relevance`, `downloads`, `newest`, `undiscovered` |
| `page` | int | `1` | `1` – `100000` |
| `limit` | int | `100` | `1` – `100` |

### Response

```json
{
  "query": "pastel",
  "assets": [
    {
      "id": "…",
      "title": "…",
      "thumbnail": "https://…",
      "assetUrl": "https://…",
      "creatorId": "…",
      "creatorName": "…",
      "keywords": ["sticky note", "pastel"],
      "contentType": "photo",
      "downloads": null,
      "createdAt": null,
      "status": "unknown"
    }
  ],
  "total": 238,
  "page": 1,
  "pageSize": 100,
  "hasMore": true,
  "source": "ok",
  "notice": "Official Adobe Stock API. …",
  "provider": "adobe-stock-api"
}
```

Field notes:

- `q` is sent to Adobe as `search_parameters[words]`. `sort` maps to `order` (`relevance` → `relevance`, `downloads` → `nb_downloads`, `newest` → `creation`, `undiscovered` → `undiscovered`). `filter` maps to content-type filters; `transparent` uses `filters[transparent]=true` and `ai` uses `filters[gentech]=only`.
- `source` is one of `ok | empty | unavailable | blocked | rate_limited | timeout | error`. When `source` is not `ok`, `assets` is `[]`, `total` is `null`, and `hasMore` is `false`.
- `total` comes from the API's `nb_results`; `pageSize`/`hasMore` describe the current page.
- `downloads` and `createdAt` are `null` — the official API does not expose them (rendered as "Download count unavailable" / "Unavailable"). `creatorName` and `keywords` come from `result_columns[]` when the API returns them.
- When the sort is a download-ranking (`downloads` or `undiscovered`), each asset carries a `popularity` object — `{ percentile, rank, source: "popularity-signal" }` — derived from Adobe's own ranking order. It is a **signal, not a real download count**, and the UI labels it "Popularity signal". Never shown as an exact count.
- When `ADOBE_STOCK_API_KEY` (alias `ADOBE_API_CLIENT_ID`) is not configured, `source` is `unavailable` with a setup message. **No data is fabricated in any state.**
- Every successful search also records local history: the asset observations feed the summary cards and trend charts.

### Errors

| Status | Code | When |
| --- | --- | --- |
| `400` | `INVALID_QUERY` | missing/empty `q`, unknown `filter`/`sort`, or `page`/`limit` out of range |
| `429` | `RATE_LIMITED` | too many requests from your IP |

---

## `GET /api/assets/:assetId`

Single-asset lookup by numeric Adobe media ID (**Asset ID search mode**). Uses `search_parameters[media_id]` against the official API when credentials are configured; otherwise returns the generated site link with `source: "unavailable"`. Also returns local tracking (first/last seen, observation count) for the asset.

### Response

```json
{
  "asset": {
    "id": "111111",
    "title": "…",
    "thumbnail": "https://…",
    "assetUrl": "https://stock.adobe.com/images/…/111111",
    "creatorId": "210467855",
    "creatorName": "Test Contributor",
    "contentType": "photo",
    "dimensions": { "width": 3000, "height": 2000 },
    "category": { "id": 1, "name": "Test Category" },
    "isGenerativeAI": true,
    "popularity": { "percentile": 100, "rank": 1, "source": "popularity-signal" },
    "observationCount": 1,
    "firstSeenAt": "2026-08-08T10:50:41.302Z",
    "lastSeenAt": "2026-08-08T10:50:41.302Z"
  },
  "link": "https://stock.adobe.com/search?k=111111&limit=100&…",
  "source": "ok",
  "sourceMessage": null,
  "provider": "adobe-stock-api",
  "tracking": { "adobeAssetId": "111111", "firstSeenAt": "…", "lastSeenAt": "…", "observationCount": 1 },
  "historyAvailable": false,
  "storeLabel": "Session-only (in-memory) — configure DATABASE_URL to persist"
}
```

Field notes:

- `asset` is `null` when the API finds no file for that ID (honest empty lookup).
- `source` is `unavailable` in link mode with a setup message explaining the app only generates the search link in that state.
- `popularity` is a ranking-derived signal, never a real download count.

### Errors

| Status | Code | When |
| --- | --- | --- |
| `400` | `INVALID_ASSET_ID` | non-numeric or missing `assetId` |
| `429` | `RATE_LIMITED` | too many requests from your IP |

---

## `GET /api/assets/:assetId/history?range=7d|30d|90d|all`

Historical observations for one asset, used by the trend chart.

### Query parameters

| Name | Type | Default | Allowed |
| --- | --- | --- | --- |
| `range` | string | `30d` | `7d`, `30d`, `90d`, `all` |

### Response

```json
{
  "assetId": "111111",
  "range": "30d",
  "points": [
    { "observedAt": "2026-08-08T10:50:41.302Z", "value": 100, "source": "popularity-signal" }
  ],
  "current": 100,
  "previous": null,
  "change": null,
  "changePercent": null,
  "metricLabel": "Popularity signal",
  "notice": "Historical database is not configured — observations shown here are session-only and not persisted. Set DATABASE_URL to enable persistent history.",
  "historyAvailable": false,
  "storeLabel": "Session-only (in-memory) — configure DATABASE_URL to persist"
}
```

Field notes:

- `metricLabel` is `"Download count"` when the provider records exact counts (`source: "official-api-exact"`), otherwise `"Popularity signal"`. The UI always shows the label so a signal is never mistaken for a real count.
- `change`/`changePercent` are `null` until at least two observations exist.

### Errors

| Status | Code | When |
| --- | --- | --- |
| `400` | `INVALID_ASSET_ID` | non-numeric or missing `assetId` |
| `400` | `INVALID_QUERY` | unknown `range` |
| `429` | `RATE_LIMITED` | too many requests from your IP |

---

## `GET /api/assets/:assetId/links`

Generated `stock.adobe.com` URL for an **Asset ID** (`k=<assetId>` search link). **Requires no credentials and never fetches from Adobe.**

```json
{ "assetId": "111111", "link": "https://stock.adobe.com/search?k=111111&limit=100&…", "mode": "link", "provider": "search-link" }
```

### Errors

| Status | Code | When |
| --- | --- | --- |
| `400` | `INVALID_ASSET_ID` | non-numeric or missing `assetId` |
| `429` | `RATE_LIMITED` | too many requests from your IP |

---

## `GET /api/creator/:creatorId/overview?limit=50`

Creator dashboard assembled from the local history index: name, portfolio link, first/last seen, indexed asset count, content-type breakdown, top assets, and top keywords. `overview` is `null` until the creator has been searched.

### Response

```json
{
  "creatorId": "210467855",
  "overview": {
    "adobeCreatorId": "210467855",
    "creatorName": "Test Contributor",
    "portfolioUrl": "https://stock.adobe.com/contributor/210467855",
    "firstSeenAt": "…",
    "lastSeenAt": "…",
    "totalIndexedAssets": 3,
    "contentTypes": [ { "contentType": "photo", "count": 1 }, { "contentType": "vector", "count": 1 } ],
    "topAssets": [ { "adobeAssetId": "111111", "title": "…", "thumbnailUrl": "…", "lastValue": 100, "lastValueSource": "popularity-signal" } ],
    "topKeywords": [ { "keyword": "stub", "count": 2 } ]
  },
  "historyAvailable": false,
  "storeLabel": "Session-only (in-memory) — configure DATABASE_URL to persist",
  "availability": {
    "officialApiAvailable": true,
    "downloadData": { "status": "not_provided", "message": "Download data unavailable - …" },
    "acceptanceData": { "status": "not_provided", "message": "Contributor acceptance data unavailable - …" },
    "uploadHistory": { "status": "not_provided", "message": "Upload date unavailable - …" },
    "salesHistory": { "status": "not_provided", "message": "Weekly contributor sales unavailable - …" }
  }
}
```

Field notes:

- `availability` reports the honest per-field data availability for this creator. `status` is one of `available | unavailable | not_provided | not_authorized`. With the official Adobe Stock API every metric Adobe does not expose is `not_provided` (never guessed); in link mode they are `unavailable`. Weekly contributor sales are never shown.

### Errors

| Status | Code | When |
| --- | --- | --- |
| `400` | `INVALID_CREATOR_ID` | non-numeric or missing `creatorId` |
| `429` | `RATE_LIMITED` | too many requests from your IP |

---

## `GET /api/creator/:creatorId/availability`

Per-field data availability for a contributor, available even before the creator has been searched. Works in both API and link modes and never guesses a value.

```json
{
  "creatorId": "210467855",
  "provider": "adobe-stock-api",
  "mode": "api",
  "availability": {
    "officialApiAvailable": true,
    "downloadData": { "status": "not_provided", "message": "Download data unavailable - …" },
    "acceptanceData": { "status": "not_provided", "message": "Contributor acceptance data unavailable - …" },
    "uploadHistory": { "status": "not_provided", "message": "Upload date unavailable - …" },
    "salesHistory": { "status": "not_provided", "message": "Weekly contributor sales unavailable - …" }
  }
}
```

### Errors

| Status | Code | When |
| --- | --- | --- |
| `400` | `INVALID_CREATOR_ID` | non-numeric or missing `creatorId` |
| `429` | `RATE_LIMITED` | too many requests from your IP |

---

## `GET /api/license-history?query=&from=&to=&page=&limit=`

"My License History" — the **authenticated user's own** licensing history from the official Adobe Stock License History API (`https://stock.adobe.io/Rest/Libraries/1/Member/LicenseHistory`). This is never another contributor's download history.

Requires two server-side credentials:

- `ADOBE_STOCK_API_KEY` (sent as `x-api-key`) — otherwise `authorized` is `false` and the response explains setup.
- `ADOBE_STOCK_ACCESS_TOKEN` (sent as `Authorization: Bearer`) — without it `authorized` is `false` with a "not authorized" message.

Adobe's endpoint cannot filter by text or date server-side, so the app scans upstream pages (bounded by `ADOBE_LICENSE_HISTORY_MAX_PAGES`, default 10, 100 entries per page) and applies the filters locally.

### Query parameters

| Name | Type | Default | Notes |
| --- | --- | --- | --- |
| `query` | string | — | Case-insensitive substring match over title, creator name/ID, asset ID, and license type (applied locally) |
| `from` | string | — | `YYYY-MM-DD` start of the license-date window (inclusive, applied locally) |
| `to` | string | — | `YYYY-MM-DD` end of the license-date window (inclusive, applied locally) |
| `page` | int | `1` | `1` – `100000` |
| `limit` | int | `100` | `1` – `100` |

### Response

```json
{
  "entries": [
    {
      "assetId": "111111",
      "title": "Stub Asset One",
      "thumbnailUrl": "https://…/500/400",
      "detailsUrl": "https://stock.adobe.com/images/…/111111",
      "creatorId": "210467855",
      "creatorName": "Test Contributor",
      "contentType": "image/jpeg",
      "licenseType": "Standard",
      "licenseDate": "2025-06-01T12:00:00.000Z",
      "licenseDateRaw": "2025-06-01T12:00:00Z",
      "downloadUrl": "https://stock.adobe.com/license/download/0"
    }
  ],
  "total": 45,
  "scanned": 45,
  "truncated": false,
  "page": 1,
  "pageSize": 100,
  "hasMore": false,
  "authorized": true,
  "source": "ok",
  "notice": "Source: Adobe Stock License History API. This is the authenticated account's own license history, not another contributor's download history.",
  "provider": "adobe-stock-api"
}
```

Field notes:

- `total` is the account's total licensed-asset count (`nb_results`); `scanned` is how many the app actually read given the page cap; `truncated` is `true` when `scanned < total`, and the `notice` then explains that refining the search will reveal older entries.
- `source` is one of `ok | empty | unavailable | blocked | rate_limited | timeout | error`. When not `ok`, `entries` is `[]`, `total` is `null`, `authorized` is `false`, and `sourceMessage` explains why (e.g. missing token, API setup required, upstream error).
- Thumbnails prefer `thumbnail_500_url`, falling back to `thumbnail_1000_url` then `thumbnail_url`. **No license history is ever fabricated.**

### Errors

| Status | Code | When |
| --- | --- | --- |
| `400` | `INVALID_QUERY` | invalid `from`/`to` date, `query` longer than 300 chars, or `page`/`limit` out of range |
| `429` | `RATE_LIMITED` | too many requests from your IP |

---

## `GET /api/analytics/summary`

Dashboard summary cards derived from the local index. `historyAvailable` is `false` and `storeLabel` names the in-memory store when no `DATABASE_URL` is configured.

```json
{
  "totalAssets": 3,
  "indexedAssets": 3,
  "assetsWithAvailableMetrics": 3,
  "totalObservations": 3,
  "historyAvailable": false,
  "storeLabel": "Session-only (in-memory) — configure DATABASE_URL to persist",
  "providerMode": "api",
  "provider": "adobe-stock-api"
}
```

---

## `GET /api/analytics/keywords?limit=50`

Most-used keywords across all locally indexed assets, with the asset count they were derived from and the source (`database` when persisted, `session` otherwise).

```json
{
  "keywords": [ { "keyword": "stub", "count": 2 }, { "keyword": "test", "count": 1 } ],
  "totalAssets": 3,
  "source": "session",
  "historyAvailable": false,
  "storeLabel": "Session-only (in-memory) — configure DATABASE_URL to persist"
}
```

---

## `GET /api/creator/:creatorId/stats`

Aggregated totals for a creator. Results are cached in memory for `CACHE_TTL_MS`.

### Response

```json
{
  "creatorId": "214711383",
  "totalAssets": 42,
  "downloadedAssets": null,
  "undownloadedAssets": null,
  "totalDownloads": null,
  "totalDownloadsIsPartial": false,
  "source": "ok",
  "notice": "Official Adobe Stock API. …",
  "provider": "adobe-stock-api"
}
```

Field notes:

- `totalAssets` comes from the API's `nb_results`.
- `downloadedAssets`, `undownloadedAssets`, and `totalDownloads` are `null` with the official Adobe Stock API, because it does not expose per-asset download counts and has no undiscovered-only filter. They are only populated by providers whose `capabilities` prove the numbers are real.
- When the source is unreachable or unconfigured, aggregates are `null` and `source`/`sourceMessage` explain why.
