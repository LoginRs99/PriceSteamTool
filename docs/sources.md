# Source Comparison & Integration Analysis

This document provides a thorough analysis of each game price source, detailing its API capabilities, authentication, rate limits, batching mechanisms, regional support, historical low tracking, and integration strategy.

---

## 1. Source Comparison Matrix

| Source | Official API | Auth Required | Batch Support | Rate Limit / Pacing | Region Support | Historical Low | Browser Required | Role |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Steam (Input & Store)** | Undocumented / Web API | None for public wishlists | Batch AppDetails (up to 20) | ~1 req/s | EU / Global / HU | No (Store current only) | No | **Canonical Input & Baseline** |
| **IsThereAnyDeal (ITAD)** | **Yes (REST v2 / v3)** | Free API Key | **Yes (up to 200 IDs)** | 5 req/s recommended | EU / Global / Multi-country | **Yes** (Built-in `historyLow`) | No | **Primary Source (Official Stores)** |
| **GG.deals** | **Yes (Developer API / Endpoints)** | Optional / Free Key | Per-game / small batches | ~1 req / 1.5s | EU / Global / Retailer tags | **Yes** (Deal score & history) | No | **Primary / Secondary (Official + Keyshops)** |
| **CheapShark** | **Yes (Public REST API)** | None (`User-Agent` req.) | Store-wide / Deal batches | ~1 req / 1s (`Retry-After`) | US / EU / Global | **Yes** (`cheapestPriceEver`) | No | **Secondary Source (Official + Cross-check)** |
| **AllKeyShop** | No (Unofficial JSON / Web) | None | No (Per-title search) | 1 req / 3-5s (Conservative) | EU / Global / Key types | Varies | Fallback only if blocked | **Fallback (Keyshop Coverage)** |
| **GoCDKeys** | No (Unofficial JSON / Web) | None | No (Per-title search) | 1 req / 5s (Conservative) | EU / Global | No | Fallback only if blocked | **Fallback (Additional Keyshop Coverage)** |

---

## 2. Detailed Source Profiles

### 2.1 Steam Wishlist & Storefront API
* **Canonical Role**: Source of truth for user wishlist entries (games, priorities, dates added, canonical `steam_app_id`, titles, header images).
* **Endpoints**:
  * Wishlist fetch: `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid={steamId64}`
  * Store details fallback: `https://store.steampowered.com/api/appdetails?appids={appId}&cc=hu&filters=basic,price_overview`
* **Handling Strategy**:
  1. Fetches raw wishlist array in single or chunked calls.
  2. Resolves game details and caches them permanently with periodic metadata refreshes.
  3. Uses Steam Store current price as baseline merchant offer (`Steam Store`).

### 2.2 IsThereAnyDeal (ITAD)
* **Canonical Role**: Primary aggregator for 40+ verified official stores (Steam, Humble Store, Fanatical, GOG, Green Man Gaming, Gamesplanet, WinGameStore, GameBillet, etc.).
* **API Endpoints**:
  * Game ID Lookup: `GET https://api.isthereanydeal.com/games/lookup/v1?key={API_KEY}&appid={steamAppId}`
  * Price Batch: `POST https://api.isthereanydeal.com/games/prices/v3?key={API_KEY}&country=HU` (Payload: array of ITAD game UUIDs, max 200 items per request).
  * Overview Batch: `POST https://api.isthereanydeal.com/games/overview/v2?key={API_KEY}&country=HU` (Returns current best price + historical low across all shops in single request).
* **Batch Efficiency**: 2,000 games require only **~10 HTTP POST requests** to refresh all prices and historical lows.
* **Rate Limit Policy**: Paced at 1 request per 1000ms with token-bucket limiter; safe for multi-thousand catalog syncs without risking 429 errors.
* **Circuit Breaker**: If 429 or 403 occurs, backoff for 30s; trip circuit breaker after 3 consecutive failures.

### 2.3 GG.deals
* **Canonical Role**: Primary source for hybrid coverage (both verified official retail stores and curated marketplace keyshops like K4G, Kinguin, CDKeys, Eneba, Gamivo).
* **API Endpoints**:
  * Price Lookup by Steam AppID: `GET https://gg.deals/api/prices/?steam_app_id={appId}` or structured deal search endpoint.
  * Direct game details: Parses structured metadata, current lowest official deal, current lowest keyshop deal, merchant name, activation type, and historical low.
* **Rate Limit Policy**: Paced at 1 request every 1500ms with jitter.
* **Circuit Breaker**: Trips on repeated rate-limits (HTTP 429) or Cloudflare verification challenges, entering `PAUSED` state for 30 minutes to prevent IP blocks.

### 2.4 CheapShark
* **Canonical Role**: Fast, key-less secondary verification across 30+ digital storefronts.
* **API Endpoints**:
  * Store List: `GET https://www.cheapshark.com/api/1.0/stores` (cached in-memory for 7 days).
  * Deals Lookup: `GET https://www.cheapshark.com/api/1.0/deals?steamAppID={appId}`
  * Game Deals: `GET https://www.cheapshark.com/api/1.0/games?id={gameId}`
* **Rate Limit Policy**: Respects `Retry-After` header. Default delay: 1000ms between requests.
* **Circuit Breaker**: If 429 received, waits according to `Retry-After` header + 500ms safety buffer.

### 2.5 AllKeyShop
* **Canonical Role**: Deep keyshop comparison fallback.
* **Integration Reality**:
  * Does not offer a free public developer REST API.
  * Internal JSON endpoints and search feeds are subject to bot detection.
* **Strategy**:
  * Executed only for games where higher keyshop coverage is requested.
  * Adapter attempts lightweight JSON search endpoint first using standard HTTP client with rotating headers.
  * If anti-bot challenge is detected, adapter gracefully skips and trips circuit breaker into `PAUSED` without stalling the rest of the sync pipeline.
  * Headless browser worker is only spawned if explicitly enabled in configuration.

### 2.6 GoCDKeys
* **Canonical Role**: Secondary keyshop comparison fallback.
* **Integration Reality**:
  * No public API; strictly monitored web endpoints.
* **Strategy**:
  * Low priority fallback queue.
  * Throttled to 1 request every 5000ms.
  * Circuit breaker trips on single 403/429 response.

---

## 3. Pacing & Concurrency Summary

```text
Sync Orchestrator
  ├── ITAD Queue       (Concurrency: 1, Delay: 1000ms, Batch: 100-200 games/req)
  ├── GG.deals Queue   (Concurrency: 1, Delay: 1500ms, Batch: 1 game/req)
  ├── CheapShark Queue (Concurrency: 1, Delay: 1000ms, Batch: 1 game/req)
  ├── AllKeyShop Queue (Concurrency: 1, Delay: 4000ms, Batch: 1 game/req, Opt-in)
  └── GoCDKeys Queue   (Concurrency: 1, Delay: 5000ms, Batch: 1 game/req, Opt-in)
```

By decoupling source queues, a delay or circuit trip in AllKeyShop has zero impact on ITAD or CheapShark throughput.
