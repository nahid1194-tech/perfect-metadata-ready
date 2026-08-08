# Known Limitations

## 1. Credentials are required for in-app data — search-link mode is the credential-free fallback

The dashboard uses only the official Adobe Stock API and **never scrapes the website** and **never fetches `stock.adobe.com` HTML**. Without a configured API key the app runs in **search-link mode**: it generates `stock.adobe.com` search URLs (for a creator: Downloaded / Undownloaded / Recent / PNG / Vector; for a keyword search: Relevance / Most downloaded / Newest / Undiscovered sorts and content-type + AI filters; for an Asset ID: a direct `k=<assetId>` search link) and opens Adobe's own result pages in a new tab. That mode always works and shows the "API not connected" banner. In link mode no asset cards are rendered at all — the dashboard only opens Adobe's site.

If the official API provider is used anyway:

- `ADOBE_STOCK_API_KEY` (or the alias `ADOBE_API_CLIENT_ID`) unset → every request returns `source: "unavailable"` with a setup message. No numbers appear.
- Invalid/expired key → the API rejects with `401`, surfaced as `source: "blocked"` with the API's error text.
- Adobe can also rate-limit (`429`) or block requests; those map to `rate_limited` / `blocked` states.

In every one of these states the response is honest and empty — the app never fabricates data.

## 2. The official API does not expose download counts or creation dates

The Adobe Stock Search API (and the companion Files API) return **no per-asset download counts** and **no creation dates**. `order=nb_downloads`, `order=creation`, and `order=undiscovered` are orderings that Adobe applies server-side; the actual numbers are not part of the response.

Consequences (all by design, all shown honestly):

- `downloads` and `createdAt` per asset are `null` — rendered as "Download count unavailable" / "Unavailable".
- `downloadedAssets`, `undownloadedAssets`, and `totalDownloads` stats are `null` with the official API.
- The **Undiscovered** tab is an *ordering* (`order=undiscovered`), not a hard filter — the result set still contains the creator's full catalog, ordered so least-common assets come first.
- The **Asset / Title search** has the same limits: its cards show no download counts and no upload dates. It *does* surface `creator_name` and `keywords` via `result_columns[]` when Adobe returns them, and the **Export CSV** contains only what the API actually returned (missing fields are written as `unavailable`).

The search-link mode is not affected by this: it opens Adobe's site directly, where the real counts are visible.

## 3. Ascending sorts are not available

Adobe's API only supports descending orders. `downloads-asc` and `creation-asc` map to the same descending API calls; the UI keeps the options but results remain in descending order.

## 4. The content-type mapping is best-effort

The API returns `content_type` (MIME), `media_type_id`, and `vector_type`. The provider maps these to the app's content types (photo / illustration / vector / video / template / 3D / audio). The mapping is conservative but undocumented edge cases may show as `unknown`.

## 5. The result set can change between calls

Adobe's own docs warn that assets "can be added, changed, or removed by other parties between your API calls." `nb_results`, ordering, and pagination can therefore drift between successive requests.

## 6. In-memory caches and per-IP rate limiting

- The TTL cache and rate limiter are in-memory and process-local. They reset on restart and do not work across multiple server instances.
- The default rate limit is 30 requests/min per IP, configurable via `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS`. The Adobe API has its own limits that can surface as `429`.

## 7. Search links open the public site

Search-link mode relies on Adobe's public website being accessible in the user's browser and on Adobe keeping the current query parameters stable. Creator URLs are generated with `creator_id` and `limit=100`; keyword search URLs use the `k=<query>` search parameter; asset-ID URLs use `k=<assetId>` — all mirroring the reference Chrome extension, but Adobe may change their site's accepted parameters over time.

## 8. History and trends are honest signals, and may be session-only

- **No real download counts.** The official API does not expose per-asset download counts, so recorded observations are a **popularity signal** — a percentile (and rank) derived from where the asset appears in Adobe's own download ordering (`order=nb_downloads` / `order=undiscovered`). Trend values are labeled `"Popularity signal"`, never shown as exact counts. Only a hypothetical provider whose `capabilities.exposesDownloadCounts` is true would store exact counts (`source: "official-api-exact"`).
- **Session-only by default.** Without `DATABASE_URL` the history store is in-memory and process-local: observations, summary, creator overview, and trend charts reset on restart, and the UI reports `storeLabel` accordingly. Set `DATABASE_URL` (PostgreSQL + Prisma) to persist history across restarts and across multiple server instances.
- **Observations are throttled** to one point per asset per interval (`OBSERVATION_INTERVAL_MS`, default 6 h) both during interactive searches and in the background scheduler, so trend charts fill in gradually — expect a single point until assets are re-sampled.
- **Upload dates remain unavailable** in both modes: the Search API exposes no `creation_date` for individual assets, so cards and CSV show "unavailable" rather than a guess.

## 9. "My License History" requires an authorized Adobe account and a bounded scan

- **Own history only.** The License History page shows the **authenticated user's own** licensing history from the official Adobe License History API — it is never another contributor's download history, and the UI says so.
- **Credentials.** It needs both `ADOBE_STOCK_API_KEY` and an OAuth token `ADOBE_STOCK_ACCESS_TOKEN`. Without the token the endpoint returns `authorized: false` with a "not authorized" message; in link mode (no key) it returns `authorized: false` with a setup message. No license data is fabricated in any state.
- **Bounded scan.** Adobe's License History endpoint cannot filter by text or date server-side, so the app scans upstream pages (default cap 10 pages of 100 via `ADOBE_LICENSE_HISTORY_MAX_PAGES`) and filters locally. When the account has more licensed assets than the scan cap, the response sets `truncated: true` and shows a notice that refining the search reveals older entries. Very large accounts won't see the full unfiltered list in one request.
- **OAuth tokens expire.** The access token must be refreshed before expiry; an expired token surfaces as `source: "blocked"` (401) with a clear message.

## 10. Creator-level availability is explicit, never estimated

The creator dashboard's "Data availability" panel shows each field's honest status — `Available`, `Unavailable`, `Not provided`, or `Not authorized`. With the official Adobe Stock API, contributor acceptance data, upload dates, and weekly sales are always `not_provided` (Adobe does not expose them through the public API); in link mode they are `unavailable`. The app never fills these in with estimates.
