# Source Comparison & Integration Analysis

This document provides a thorough analysis of each game price source, detailing its API capabilities, authentication, rate limits, batching mechanisms, regional support, historical low tracking, and integration strategy.

---

## 1. Source Comparison Matrix

| Source | Official API | Auth Required | Batch Support | Rate Limit / Pacing | Region Support | Historical Low | Browser Required | Role |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Steam (Input & Store)** | Undocumented / Web API | None for public wishlists | **Yes (up to 200 items)** | ~1s delay | EU / Global / HU | No (Store current only) | No | **Canonical Input & Baseline** |
| **IsThereAnyDeal (ITAD)** | **Yes (REST v2 / v3)** | Free API Key | **Yes (up to 200 IDs)** | 500ms delay | EU / Global / Multi-country | **Yes** (Built-in `historyLow`) | No | **Primary Source (Official Stores)** |
| **GG.deals** | **Yes (Developer API / Endpoints)** | Optional / Free Key | **Yes (Batch & per-game)** | 1000ms delay | EU / Global / Retailer tags | **Yes** (Deal score & history) | No | **Primary / Secondary (Official + Keyshops)** |
| **CheapShark** | **Yes (Public REST API)** | None (`User-Agent` req.) | **Yes (up to 60 IDs/call)** | 500ms delay | US / EU / Global | **Yes** (`cheapestPriceEver`) | No | **Primary / Secondary (Official Stores)** |
| **AllKeyShop** | **Yes (vaks.php v2 JSON API)** | None | Smart Priority (TOP 150) | 2500ms delay | EU / Global / Key types | **Yes** (Lowest keyshop/official) | No | **Keyshop Coverage (Eneba, Kinguin, etc.)** |
| **GoCDKeys** | No (Unofficial JSON / Web) | None | No (Per-title search) | 4000ms delay | EU / Global | No | Fallback only if blocked | **Fallback (Disabled by Default)** |

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
* **Batch Efficiency**: 2,570 games require only **~17 HTTP POST requests** to refresh all prices and historical lows.
* **Rate Limit Policy**: Paced at 500ms delay with token-bucket limiter; safe for multi-thousand catalog syncs without risking 429 errors.
* **Circuit Breaker**: If 429 or 403 occurs, backoff for 30s; trip circuit breaker after 3 consecutive failures.

### 2.3 GG.deals
* **Canonical Role**: Primary source for hybrid coverage (both verified official retail stores and curated marketplace keyshops like K4G, Kinguin, CDKeys, Eneba, Gamivo).
* **API Endpoints**:
  * Price Lookup by Steam AppID: `GET https://gg.deals/api/prices/?steam_app_id={appId}` or structured deal search endpoint.
  * Direct game details: Parses structured metadata, current lowest official deal, current lowest keyshop deal, merchant name, activation type, and historical low.
* **Rate Limit Policy**: Paced at 1 request every 1000ms.
* **Circuit Breaker**: Trips on repeated rate-limits (HTTP 429) or Cloudflare verification challenges, entering `PAUSED` state for 30 minutes to prevent IP blocks.

### 2.4 CheapShark
* **Canonical Role**: High-speed, key-less official batch verification across 25+ digital storefronts.
* **API Endpoints**:
  * Store List: `GET https://www.cheapshark.com/api/1.0/stores` (cached in-memory for 24 hours).
  * Batch Deals Lookup: `GET https://www.cheapshark.com/api/1.0/deals?steamAppID=id1,id2,id3...&pageSize=60` (up to 50–60 Steam AppIDs in a single HTTP request).
  * Single Game Deals: `GET https://www.cheapshark.com/api/1.0/deals?steamAppID={appId}`
* **Rate Limit Policy**: Respects `Retry-After` header. Default batch delay: 500ms between batch requests (~50 requests total for 2,570 games).
* **Circuit Breaker**: If 429 received, waits according to `Retry-After` header + 500ms safety buffer.

### 2.5 AllKeyShop
* **Canonical Role**: Comprehensive grey-market keyshop coverage (Eneba, Kinguin, G2A, CDKeys, Instant Gaming, Gamivo, etc.).
* **Integration Strategy**:
  * Queries AllKeyShop's high-fidelity **`vaks.php` v2 JSON API** (`https://www.allkeyshop.com/api/v2/vaks.php?action=products&currency=eur&name=...`).
  * Extracts exact merchant names (*Gamivo, Eneba, Kinguin, Instant Gaming*), active voucher codes (`bestVoucher`), direct redirect URLs, and discount depths.
  * Runs with respectful 2500ms pacing across the full catalog (`ALLKEYSHOP_MAX_GAMES=0` by default), or can be capped to TOP N games via configuration.
  * If anti-bot challenge (403/429) is detected, adapter trips circuit breaker into `PAUSED` without stalling or interrupting the main sync pipeline.

### 2.6 GoCDKeys
* **Canonical Role**: Secondary keyshop comparison fallback (Disabled by default).
* **Integration Reality**:
  * No public API; strictly monitored web endpoints. 100% of its merchant coverage is already provided by AllKeyShop and GG.deals.
* **Strategy**:
  * Low priority fallback queue.
  * Throttled to 1 request every 4000ms.
  * Circuit breaker trips on single 403/429 response.

---

## 3. Pacing & Concurrency Architecture

```text
Sync Orchestrator (Parallel Multi-Source Execution)
  ├── Concurrent Batch Pool (~25s total for 2,570 games):
  │     ├── Steam Storefront (Batch: 200 items/req, Delay: 1000ms)
  │     ├── ITAD Batch       (Batch: 150 items/req, Delay: 500ms)
  │     ├── CheapShark Batch (Batch: 50-60 items/req, Delay: 500ms)
  │     └── GG.deals Batch   (Batch: 50 items/req, Delay: 1000ms)
  │
  └── Smart Priority Secondary Pool (~6m total for TOP 150):
        ├── AllKeyShop Queue (vaks.php v2 JSON API, Delay: 2500ms, TOP 150 games)
        └── GoCDKeys Queue   (Disabled by default)
```

By decoupling source queues and running batch sources in parallel, a delay or circuit trip in AllKeyShop has zero impact on ITAD or CheapShark throughput. Total wishlist synchronization runs in **under 10 minutes** across all active sources.
