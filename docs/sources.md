# Source Comparison & Integration Analysis

This document provides a thorough technical analysis of each game price source, detailing its API capabilities, authentication, rate limits, batching mechanisms, regional support, historical low tracking, and integration strategy for **Pricetool** (v2.5.0).

---

## 1. Source Comparison Matrix

| Source | Official API | Auth Required | Batch Support | Pacing & Jitter | Region Support | Historical Low | Browser Required | Role |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Steam Storefront** | Undocumented Web API | None for public wishlists | **Yes (up to 200 items)** | 2000ms (250ms jitter) | EU / Global / HU | No (Current store price) | No | **Canonical Input & MSRP Anchor** |
| **IsThereAnyDeal (ITAD)** | **Yes (REST v2 / v3)** | Free API Key | **Yes (up to 200 IDs)** | 1000ms (200ms jitter) | EU / Global / Multi-country | **Yes** (Built-in `historyLow`) | No | **Primary Source (Official Stores)** |
| **CheapShark** | **Yes (Public REST API)** | None (`User-Agent` req.) | **Yes (25 IDs/req batch)** | 1500ms (250ms jitter) | US / EU / Global | **Yes** (`cheapestPriceEver`) | No | **Official Stores + Metacritic** |
| **GG.deals** | **Yes (Developer API / JSON)**| Optional / Free Key | **Yes (Batch & per-game)** | 1500ms (300ms jitter) | EU / Global / Retailer tags | **Yes** (Deal score & history) | No | **Official + Marketplace Keyshops** |
| **AllKeyShop** | **No (Internal JSON API)** | None (Anti-bot solver) | Per-title queue | 2500ms (500ms jitter) | EU / Global / Key types | **Yes** (Lowest keyshop/official) | Solver Required | **Comprehensive Keyshop Coverage** |

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
  * **Solver Requirement**: Strictly requires an external anti-bot solver (Byparr or FlareSolverr via `ALLKEYSHOP_SOLVER_URL` / `BYPARR_URL`). Zero direct scraping fallbacks exist to protect the user's IP address.
  * **Dual-Stage Page & API Fallback**: When FlareSolverr experiences browser timeouts or HTTP 500 errors on heavy live comparison HTML pages, the adapter gracefully falls back to the lightweight JSON endpoint (`price_history_api.php`) rather than tripping source-wide failures.
  * **Fair Round-Robin Scheduling**: Due games are sorted by `allkeyshop_last_checked_at ASC` to prevent catalog starvation.
  * **Adaptive Intervals**: Implements exponential backoff per title (24h to 168h ceiling) based on price stability streak (`allkeyshop_unchanged_streak`). Active target price overrides fast-track check intervals.
  * **Pacing & Jitter**: `ALLKEYSHOP_DELAY_MS=2500` (jitter: 500ms) with exponential-tailed jitter and occasional hesitation breaks.
  * **Circuit Breaker**: If the solver challenge fails or returns 403/429/502, activates backoff/pause. Can be immediately unpaused via the UI or `POST /api/sources/allkeyshop/reset`.

---

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
        ├── GG.deals Worker  (Batch/Per-game, Delay: 1500ms, Jitter: 300ms)
        └── AllKeyShop Queue (Solver required, Delay: 2500ms, Jitter: 500ms, Adaptive 24h-168h)
```
