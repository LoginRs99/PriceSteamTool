# Source Comparison & Integration Analysis

This document provides a thorough technical analysis of each game price source, detailing its API capabilities, authentication, rate limits, batching mechanisms, regional support, historical low tracking, and integration strategy for **Pricetool** (v2.7.0).

---

## 1. Source Comparison Matrix

| Source | Official API | Auth Required | Batch Support | Pacing & Jitter | Region Support | Historical Low | Browser Required | Role |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Steam Storefront** | Undocumented Web API | None for public wishlists | **Yes (up to 200 items)** | 2000ms (250ms jitter) | EU / Global / HU | No (Current store price) | No | **Canonical Input & MSRP Anchor** |
| **IsThereAnyDeal (ITAD)** | **Yes (REST v2 / v3)** | Free API Key | **Yes (up to 200 IDs)** | 1000ms (200ms jitter) | EU / Global / Multi-country | **Yes** (Built-in `historyLow`) | No | **Primary Source (Official Stores)** |
| **CheapShark** | **Yes (Public REST API)** | None (`User-Agent` req.) | **Yes (25 IDs/req batch)** | 1500ms (250ms jitter) | US / EU / Global | **Yes** (`cheapestPriceEver`) | No | **Official Stores + Metacritic** |
| **GG.deals** | **Yes (Developer API / JSON)**| Optional / Free Key | **Yes (Batch & per-game)** | 1500ms (300ms jitter) | EU / Global / Retailer tags | **Yes** (Deal score & history) | No | **Official + Marketplace Keyshops** |
| **NEXARDA™** | **Yes (REST API v3)** | None (Public) | Per-game direct find & search | 250ms (50ms jitter) | Global / EU / Multi-currency | **Yes** (Historical low & vouchers) | No | **Official + Marketplace Keyshop Aggregator** |
| **SuperDuperBundle** | **Yes (REST API v1)** | None (Public) | Per-game direct Steam lookup | 500ms (100ms jitter) | Global / Multi-store | **No** (Current store prices) | No | **Fast Secondary Store & Key Aggregator** |
| *AllKeyShop (Deactivated)* | No (Internal JSON API) | None (Anti-bot solver) | Per-title queue | 2500ms (500ms jitter) | EU / Global / Key types | Yes | Solver Required | *Deactivated in v2.9.0 (backed up to branch)* |

---

## 2. Detailed Source Profiles

### 2.1 Steam Wishlist & Storefront API
* **Canonical Role**: Source of truth for user wishlist entries (games, priorities, dates added, canonical `steam_app_id`, titles, capsule artwork, and review scores).
* **Endpoints**:
  * Wishlist fetch: `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid={steamId64}`
  * Wishlist page fallback: `https://store.steampowered.com/wishlist/profiles/{steamId64}/wishlistdata/?p={page}`
  * App details: `https://store.steampowered.com/api/appdetails?appids={appId}&cc=hu&filters=basic,price_overview`
* **Handling Strategy**:
  1. Ingests raw wishlist games in paginated chunks.
  2. Resolves base MSRP, discount percent, release date, and review summaries.
  3. Caches game records permanently with periodic metadata refreshes.
* **Pacing & Queue**: `STEAM_DELAY_MS=2000` (jitter: 250ms). Page delay floor enforced at 2000ms.

### 2.2 IsThereAnyDeal (ITAD)
* **Canonical Role**: Primary aggregator for 40+ verified official stores (Steam, Humble Store, Fanatical, GOG, Green Man Gaming, Gamesplanet, WinGameStore, GameBillet, etc.).
* **API Endpoints**:
  * Game ID Lookup: `GET https://api.isthereanydeal.com/games/lookup/v1?key={API_KEY}&appid={steamAppId}`
  * Price Batch: `POST https://api.isthereanydeal.com/games/prices/v3?key={API_KEY}&country=HU` (Payload: array of ITAD game UUIDs, max 200 items per request).
  * Overview Batch: `POST https://api.isthereanydeal.com/games/overview/v2?key={API_KEY}&country=HU` (Current best price + historical low across all shops in a single request).
  * History Lookup: `GET https://api.isthereanydeal.com/games/history/v2?key={API_KEY}&id={itadId}&country=HU&since={ISO8601}`
* **Batch Efficiency**: 2,000+ games require only **~10–14 HTTP POST requests** to refresh all prices and historical lows.
* **Pacing & Circuit Breaker**: `ITAD_DELAY_MS=1000` (jitter: 200ms). On 429 or 403, transitions to `BACKOFF` for 30s; trips to `PAUSED` after 3 consecutive failures.

### 2.3 CheapShark
* **Canonical Role**: High-speed official batch verification across 25+ digital storefronts with **zero API key requirement** and Metacritic score enrichment.
* **API Endpoints & Architecture**:
  * Store List: `GET https://www.cheapshark.com/api/1.0/stores` (cached in-memory for 24 hours).
  * Batch Deals Lookup: `GET https://www.cheapshark.com/api/1.0/deals?steamAppID={id1,id2,...,id25}&pageSize=60&pageNumber={page}`
  * Single Game Deals: `GET https://www.cheapshark.com/api/1.0/deals?steamAppID={appId}`
  * Historical Low: `GET https://www.cheapshark.com/api/1.0/games?id={gameId}`
* **True Multi-AppID Batching**:
  * Instead of firing sequential per-game requests, `fetchBatchPrices` bundles **25 Steam App IDs per comma-separated request**.
  * Implements **pagination support** (`pageSize=60`, up to 3 pages) when a batch returns 60 deals.
  * Enriches `games.metacritic_score` and `games.metacritic_url` directly from deal payloads.
  * Separate `try/catch` on historical low lookups ensures that a missing game ID does not discard already-fetched current deals.
  * Implements **single-retry on 429**: Re-enqueues into the queue (which is in `BACKOFF` state) rather than discarding the batch.
* **Pacing & Queue**: `CHEAPSHARK_DELAY_MS=1500` (jitter: 250ms).

### 2.4 GG.deals
* **Canonical Role**: Primary source for hybrid coverage (both verified official retail stores and curated marketplace keyshops like K4G, Kinguin, CDKeys, Eneba, Gamivo).
* **API Endpoints**:
  * Price Lookup by Steam AppID: `GET https://gg.deals/api/prices/?steam_app_id={appId}` or structured deal search.
  * Direct game details: Parses structured metadata, current lowest official deal, current lowest keyshop deal, merchant name, activation type, and historical low.
* **Pacing & Queue**: `GGDEALS_DELAY_MS=1500` (jitter: 300ms). Trips to `PAUSED` on repeated 429s or Cloudflare verification challenges.

### 2.5 AllKeyShop
* **Canonical Role**: Comprehensive grey-market keyshop coverage (Eneba, Kinguin, G2A, CDKeys, Instant Gaming, Gamivo, etc.).
* **API Endpoints & Architecture**:
  * Queries AllKeyShop's unofficial internal JSON endpoints (`vaks.php` and `price_history_api.php`) for product listings, merchant offers, voucher discounts, and historical pricing.
  * **Solver Requirement & Proxy Forwarding**: Strictly requires an external anti-bot solver (Byparr or FlareSolverr via `ALLKEYSHOP_SOLVER_URL` / `BYPARR_URL`). Zero direct scraping fallbacks exist to protect the user's home IP address. Optional HTTP/SOCKS5 rotating proxies (e.g., Webshare `p.webshare.io:80`) can be forwarded to FlareSolverr via `ALLKEYSHOP_PROXY_URL` to completely isolate host IPs from Cloudflare rate limits.
  * **Chunked Pacing & Stealth Seeding**: Requests are chunked (`ALLKEYSHOP_CHUNK_SIZE=25` or `50`) with configurable cool-off pauses (`ALLKEYSHOP_CHUNK_PAUSE_MS=30000` to `180000`) and human-like jitter (`ALLKEYSHOP_JITTER_MS=1500`). For initial full database building across 1,000+ games, `ALLKEYSHOP_MAX_GAMES=0` enables unlimited batch execution while maintaining stealth pacing.
  * **Dual-Stage Page & API Fallback**: When FlareSolverr experiences browser timeouts or HTTP 500 errors on heavy live comparison HTML pages, the adapter gracefully falls back to the lightweight JSON endpoint (`price_history_api.php`) rather than tripping source-wide failures.
  * **Fair Round-Robin Scheduling**: Due games are sorted by `allkeyshop_last_checked_at ASC` to prevent catalog starvation.
  * **Adaptive Intervals**: Implements exponential backoff per title (24h to 168h ceiling) based on price stability streak (`allkeyshop_unchanged_streak`). Active target price overrides fast-track check intervals.
  * **Pacing & Jitter**: `ALLKEYSHOP_DELAY_MS=2500` (jitter: 500ms) with exponential-tailed jitter and occasional hesitation breaks.
  * **Circuit Breaker**: If the solver challenge fails or returns 403/429/502, activates backoff/pause. Can be immediately unpaused via the UI or `POST /api/sources/allkeyshop/reset`.

### 2.5.1 Evaluation of Third-Party `allkeyshop-api` (v3.0.0)
A deep technical evaluation was performed on the latest upstream release of [`sergioalmela/allkeyshop-api`](https://github.com/sergioalmela/allkeyshop-api) (v3.0.0, published October 2026):

* **Package Size Analysis**:
  * Compressed tarball: **2.1 MB** | Unpacked install size: **11.0 MB** (`11,021,458 bytes`).
  * **99.1% dead weight**: The package bundles an uncompressed 10.9 MB JSON snapshot (`dist/public/vaks.json`). Crucially, the library's runtime code (`fetch.js`) checks `os.tmpdir()` and never actually reads `dist/public/vaks.json`, making the 10.9 MB file completely unused bloat.
* **Unsolved Bugs & Critical Gaps in `allkeyshop-api@3.0.0`**:
  1. **Instant Cloudflare 403 Blocks**: Uses standard `fetch()` without a User-Agent, cookie jar, proxy, or anti-bot solver (Byparr/FlareSolverr). When executed in containerized or server environments, `allkeyshop.com` immediately blocks requests with HTTP 403.
  2. **Flawed `store: 'steam'` Filter**: Uses `fuzzy-search` to search the **merchant name** for the string `"steam"`. This discards all keyshops (Kinguin, CDKeys, Eneba) that sell Steam keys, only returning the official Steam storefront. Conversely, if no filter is supplied, it leaks non-Steam DRM (GOG, Epic, Xbox, PS5, Steam Accounts).
  3. **Greedy First-Match Resolution**: `search()` blindly takes `games[0]` from an unweighted fuzzy search without release year verification, causing severe false matches on DLCs and sequels.
  4. **Missing Payment Fees**: Ignores `priceCard` and `pricePaypal` fields, under-reporting user prices by 10%–15%.
  5. **Lack of Rate-Limiting**: Lacks token-bucket pacing, jitter, and circuit breakers, causing rapid 429 rate limits.
* **Architectural Verdict**:
  * **Do NOT adopt `allkeyshop-api` as a dependency**. PriceSteamTool's native implementation in [`src/server/sources/allkeyshop.ts`](file:///D:/github/Pricetool/src/server/sources/allkeyshop.ts) is vastly superior: zero package bloat (0 MB vs 11 MB), full Byparr/FlareSolverr solver integration, 4-state circuit breakers, dual-layer page & API fallback, exact year/edition matching, and 100% Steam DRM key filtering.

### 2.5.2 Native Hardening & TDD Enhancements (2026-10)
Following technical audits, several key resilience and accuracy enhancements were integrated directly into the native AllKeyShop adapter using Test-Driven Development (TDD):

1. **Pre-Indexed Compressed Seed Catalog (`src/server/sources/seed/allkeyshop_catalog.seed.json.gz`)**:
   * Bundles a 1.93 MB gzipped seed file containing **204,453 verified games and IDs**.
   * On cold boot, if `data/allkeyshop_catalog.json` is missing or incomplete, the catalog is unpacked in <50ms without waiting for a Cloudflare solver network connection.
2. **Franchise & Article Prefix Stripping**:
   * Uses `stripPublisherPrefixes()` to strip franchise prefixes (`Tom Clancy's`, `Sid Meier's`, `Warhammer 40,000`, `EA Sports`, `Marvel's`, `Disney's`, `The`, `A`, `An`) during candidate indexing and search.
   * Enables seamless matching for games whose titles differ between Steam and AllKeyShop (e.g. *Tom Clancy's Rainbow Six Siege* $\rightarrow$ *Rainbow Six Siege*, *Sid Meier's Civilization VI* $\rightarrow$ *Civilization 6*).
3. **Numeric ID Fast-Path Resolution**:
   * Refactored `fetchPricesForGame()` to make `price_history_api.php?normalised_name=${matched.id}` the primary fast path. Avoids brittle WordPress blog slug guessing and eliminates 404 delays.
4. **Security & Rate-Limit Hardening**:
   * Implemented `buildAksApiUrl()` with strict host allowlisting (`www.allkeyshop.com`) to prevent SSRF vulnerabilities.
   * Upgraded `parseRetryAfterHeader()` to parse both numeric seconds and RFC 7231 HTTP dates.
   * Isolated test runners from production cache paths so unit tests never overwrite `data/allkeyshop_catalog.json`.
5. **Automatic 7-Day Catalog TTL & On-Demand Manual Refresh**:
   * Master title catalog enforces a 7-day TTL (`CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000`) verified via `isCatalogFresh()`. If the file is older than 7 days, the adapter automatically redownloads the latest catalog from upstream.
   * On-demand catalog refresh endpoint: `POST /api/sources/allkeyshop/refresh-catalog` allows users to force a fresh catalog download at any time (e.g. for brand new releases) via the Source Adapters modal.

## 3. Rate Limit & Pacing Engine (`src/server/sources/base.ts`)

### 3.1 Epoch-Aware Header Parsing
The rate limiter supports standard IETF headers and Cloudflare extensions via `parseRetryAfterHeader`:
```typescript
export function parseRetryAfterHeader(headerValue?: string | null): number | undefined
```
- **Integer Seconds:** `Retry-After: 30` $\rightarrow$ 30 seconds cooldown.
- **HTTP Date:** `Retry-After: Wed, 16 Sep 2026 14:30:00 GMT` $\rightarrow$ parsed against current time.
- **Unix Epoch Timestamps:** Cloudflare `X-RateLimit-Reset` or `ratelimit-reset` timestamps ($> 1,000,000,000$) are automatically detected and converted into delta cooldown seconds:
  $$\Delta t = \text{epochTimestamp} - \left\lfloor\frac{\text{now}}{1000}\right\rfloor$$

### 3.2 Pacing Architecture Summary

```text
Sync Orchestrator (Parallel Multi-Source Execution)
  ├── Fast Batch Pool (Total ~25–40s for 2,000+ games):
  │     ├── Steam Storefront (Batch: 200 items/req, Delay: 2000ms, Jitter: 250ms)
  │     ├── ITAD Batch       (Batch: 150-200 items/req, Delay: 1000ms, Jitter: 200ms)
  │     └── CheapShark Batch (Batch: 25 AppIDs comma-separated, Delay: 1500ms, Jitter: 250ms)
  │
  └── Selective Secondary Pool:
        ├── GG.deals Worker       (Batch/Per-game, Delay: 1500ms, Jitter: 300ms)
        ├── NEXARDA Worker        (Per-game find/search, Delay: 250ms, Jitter: 50ms)
        └── SuperDuperBundle      (Per-game lookup, Delay: 500ms, Jitter: 100ms)
```
