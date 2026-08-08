# Adobe Stock Tracker

An open-source dashboard for analyzing **public Adobe Stock assets**: look up a contributor by **Creator ID**, find a specific asset by **Asset ID**, or search the catalog by **title / keyword** — with download ranking, content types, generative-AI filtering, and optional history/trend analytics. Built with React + Vite + TypeScript + Tailwind CSS + shadcn/ui on the frontend and an Express (Node.js) API on the backend.

> **Data honesty**: this tool never fabricates data, never scrapes Adobe's website, and never bypasses Adobe's security. With API credentials it reads only what the **official Adobe Stock API** exposes. Without credentials it runs in **search-link mode**: it generates `stock.adobe.com` search URLs (exactly like the reference Chrome extension) and opens Adobe's own result pages — no fake counts, no hidden endpoints, no backend fetching of Adobe HTML. Historical "download" trends are labeled exactly by their provenance: an **exact count** only when the API provides one, otherwise a **popularity signal** (a percentile derived from Adobe's own ranking), never an invented number.

## Features

- Three search modes via a **Search Type** selector — **Creator** (by numeric Creator ID), **Asset ID** (numeric media ID, single-asset lookup), and **Title / Keyword** (free-text keyword/title search)
- **Search-link mode** (no API key needed): buttons that open Adobe's own search pages in a new tab — for a creator: **Downloaded**, **Undownloaded**, **Recent**, **PNG**, **Vector** — preserving `creator_id`, `limit=100`, content-type filters and pagination; for a keyword search: sort (**Relevance / Most downloaded / Newest / Undiscovered**) and content-type filters (**Photo / Illustration / Vector / PNG · Transparent / Video / Template / 3D / AI**) via the `k=` search parameter; for an Asset ID: a direct `k=<assetId>` search link
- **"Open on Adobe Stock"** buttons on the search-link panel and on every asset card
- When an Adobe API key is set: full in-app dashboard — asset grid, filters, sorting, stat cards, load-more — backed by the official Adobe Stock API
- **Keyword/title search in API mode**: total result count, Relevance / Most downloaded / Newest / Undiscovered sorting, content-type + **AI-only** (`filters[gentech]=true`) filters, load-more pagination, **Export CSV**, and honest per-card metadata (title, asset ID, contributor, keywords, content type, dimensions, category, AI badge — download counts and upload dates shown as *unavailable* when the API does not expose them)
- **Asset cards** show previews, a copyable Asset ID, a **Copy keywords** / **Copy metadata** / **View details** modal with per-field availability labels, and a data-source label — every field Adobe doesn't expose is labeled *Not provided by official API*, never estimated
- **My License History**: a dedicated page (nav item) showing the **authenticated account's own** licensing history from the official Adobe License History API — search, date-window filter, pagination, and **Export CSV**. Requires `ADOBE_STOCK_ACCESS_TOKEN`; without it the page shows a clear "not authorized" banner, never fake data
- **Creator dashboard "Data availability" panel**: per-field honest status (Official API / Download data / Contributor acceptance / Upload history / Weekly sales — `Available`, `Unavailable`, `Not provided`, or `Not authorized`)
- **History & trends**: assets and creators are automatically tracked as you search; a background job re-samples tracked creators, and an SVG trend chart shows current vs. previous period with a range selector (`7d / 30d / 90d / all`). Trend values are labeled as exact counts (only when a provider exposes them) or popularity signals
- **Optional PostgreSQL persistence** via Prisma (`DATABASE_URL`): durable history, keyword analytics, and a creator overview dashboard. Without a database the same UI runs on a session-only in-memory store, clearly labeled as not persisted
- Clear **"API not connected"** message instead of invented numbers when credentials are missing
- **Replaceable data-provider layer** (`AdobeStockDataProvider`) — the UI and routes never talk to Adobe directly, so the source can be swapped without rebuilding the UI
- Honest source-status reporting (ok / blocked / rate-limited / timeout / unavailable / error)

## Requirements

- Node.js 20+ (built and tested with Node 26)
- npm 10+ (tested with npm 11)

> Note for npm 11: npm's `allow-scripts` gate blocks `esbuild`'s postinstall. Run `npm approve-scripts esbuild --all` once after install, or `npm run dev` will fail.

## Getting started

```bash
npm install
npm approve-scripts esbuild --all   # npm 11 only
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:4000
- Health check: http://localhost:4000/api/health

Open the app. Use the **Creator** search type with a numeric Creator ID (for example `214711383`), switch to **Title / Keyword** to search by keyword (for example `Isolated Pastel Sticky Note Collection`), or use **Asset ID** with a numeric media ID. Asset searches and creator lookups automatically record history, so the **Summary** cards, **Creator overview**, and per-asset **trend charts** populate as you use the app.

Without configuration the app runs in **search-link mode** out of the box: you get the "API not connected" banner and buttons that open Adobe's own result pages — for creators the Downloaded / Undownloaded / Recent / PNG / Vector views, for keyword searches the sort and content-type variants. In this mode **asset cards are never shown** because no data can be fetched — the dashboard only opens Adobe's site. When you connect the API key, the same search shows the full asset grid, sorting, filters, CSV export, and honest metadata.

## Connecting the official Adobe Stock API

The in-app dashboard uses the [official Adobe Stock Search API](https://developer.adobe.com/stock/docs/getting-started/02-register-app).

1. Create a free API key at the [Adobe Developer Console](https://developer.adobe.com) (project type "Stock").
2. Copy `.env.example` to `server/.env`.
3. Set `ADOBE_STOCK_API_KEY` to your key (`ADOBE_API_CLIENT_ID` is accepted as an alias).

The provider is auto-selected: with an API key set the API provider is used; without it, search-link mode.

## Optional: My License History (authorized account)

The **My License History** page shows your own licensing history from the official Adobe License History API — it is the authenticated user's history only, never another contributor's download history.

1. In the same `server/.env`, set `ADOBE_STOCK_ACCESS_TOKEN` to an OAuth access token for your Adobe Stock account (e.g. from a Service Account / OAuth2 integration). `ADOBE_API_ACCESS_TOKEN` is accepted as an alias.
2. Restart the server. The page fetches from `https://stock.adobe.io/Rest/Libraries/1/Member/LicenseHistory`, scanning a bounded number of pages (`ADOBE_LICENSE_HISTORY_MAX_PAGES`, default 10) and applying your search/date filters locally.

Without the token the page shows a clear "not authorized" message; without any credentials (link mode) it shows a setup message. No license history is ever fabricated.

## Optional: PostgreSQL history

History and trend analytics work out of the box on a session-only in-memory store. To persist them across restarts, provide a PostgreSQL connection string:

1. Set `DATABASE_URL` in `server/.env` (see `.env.example`).
2. Run `npx prisma migrate dev --schema prisma/schema.prisma` (or `npx prisma db push --schema prisma/schema.prisma`) from the repo root.
3. Restart the server. The summary/overview/history responses will report the database store instead of the in-memory one.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Run the API (port 4000) and Vite dev server (port 5173) together |
| `npm run dev:server` | API only |
| `npm run dev:client` | Vite dev server only |
| `npm run typecheck` | Type-check server and client |
| `npm run build` | Build server and client |
| `npm start` | Run the built server (serves `client/dist` too) |

## Configuration

All settings have safe defaults and live in `.env` (see `.env.example`):

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4000` | API port |
| `ADOBE_DATA_PROVIDER` | _(auto)_ | `adobe-stock-api`, `search-link`, or empty for auto-select |
| `ADOBE_STOCK_API_KEY` | _(empty)_ | Your Adobe Stock API key (`x-api-key`). Required for in-app data. `ADOBE_API_CLIENT_ID` is a supported alias. |
| `ADOBE_STOCK_PRODUCT` | `AdobeStockTracker/1.0` | `X-Product` header (`ADOBE_API_PRODUCT` is a supported alias) |
| `ADOBE_STOCK_ACCESS_TOKEN` | _(empty)_ | OAuth token for **My License History** (`Authorization: Bearer`). `ADOBE_API_ACCESS_TOKEN` is a supported alias. |
| `ADOBE_LICENSE_HISTORY_BASE_URL` | `https://stock.adobe.io/Rest/Libraries/1/Member/LicenseHistory` | License History endpoint |
| `ADOBE_LICENSE_HISTORY_MAX_PAGES` | `10` | Max upstream pages scanned for License History search/filter |
| `ADOBE_API_BASE_URL` | `https://stock.adobe.io/Rest/Media/1/Search/Files` | Search/Files endpoint |
| `ADOBE_API_LOCALE` | `en_US` | Response locale |
| `ADOBE_API_TIMEOUT_MS` | `15000` | Upstream fetch timeout |
| `ADOBE_API_LIMIT` | `100` | Assets per upstream page (max 100) |
| `ADOBE_API_MAX_PAGES` | `5` | Max upstream pages fetched for aggregated stats |
| `ADOBE_REQUEST_CONCURRENCY` | `2` | Max concurrent upstream requests (polite client-side queue) |
| `ADOBE_MAX_RETRIES` | `2` | Retries for transient upstream failures (429/5xx) |
| `ADOBE_BACKOFF_BASE_MS` | `1000` | Base retry backoff (ms), doubles per attempt |
| `ADOBE_SEARCH_BASE_URL` | `https://stock.adobe.com/search` | Base page for generated search links |
| `ADOBE_SEARCH_LIMIT` | `100` | `limit` parameter in generated search links |
| `DATABASE_URL` | _(empty)_ | Optional PostgreSQL connection string for persistent history (Prisma) |
| `OBSERVATION_SCHEDULER_ENABLED` | `true` | Run the background observation job |
| `OBSERVATION_START_DELAY_MS` | `5000` | Delay before the first job run after boot |
| `OBSERVATION_INTERVAL_MS` | `21600000` | Job interval (ms, default 6 h) |
| `OBSERVATION_PER_CREATOR_LIMIT` | `100` | Max assets per creator sampled per job run |
| `CACHE_TTL_MS` | `300000` | In-memory cache TTL |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window |
| `RATE_LIMIT_MAX_REQUESTS` | `30` | Max requests per window |

## Documentation

- [Architecture](./docs/architecture.md)
- [API reference](./docs/API.md)
- [Known limitations](./docs/known-limitations.md)

## License

MIT
