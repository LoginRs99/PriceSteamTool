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
| **NEXARDA™** | **Yes (REST API v3)** | None (Public) | Per-game direct find & search | 500ms (100ms jitter) | Global / EU / Multi-currency | **Yes** (Historical low & vouchers) | No | **Official + Marketplace Keyshop Aggregator** |
| **SuperDuperBundle** | **Yes (REST API v1)** | Optional (`X-API-Key`) | **Yes (50 IDs/req batch)** | 1000ms (200ms jitter) | Global / EU / Multi-store | **No** (Current store prices) | No | **Fast Secondary Store & Key Aggregator** |
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

### 2.5 AllKeyShop (Retired / Preserved in Backup Branch)
* **Status**: Retired from the active production build as of v2.10.1 in favor of modern, high-speed official REST API aggregators (NEXARDA™ and SuperDuperBundle).
* **Backup Branch**: The complete working unofficial scraper, FlareSolverr/Byparr anti-bot integration, compressed seed catalog (204k+ games), and candidate matching engine are fully preserved in git branch `backup/allkeyshop-full-scraper` for future reference or if an official developer API becomes available.
* **Database Compatibility**: Existing historical prices and offers recorded with `sourceCode: 'allkeyshop'` remain preserved in the SQLite database and continue to inform historical lows and analytics without errors.

### 2.6 NEXARDA™
* **Canonical Role**: Modern REST API aggregator comparing over 65 verified digital retailers and secondary keyshops with automated voucher extraction and net price calculations.
* **API Endpoints**:
  * Direct Steam ID Resolution: `GET https://www.nexarda.com/api/v3/find?steam={steamAppId}&output=json`
  * Multi-Tier Search Fallback: `GET https://www.nexarda.com/api/v3/search?type=games&q={candidateQuery}`
  * Prices & Offers: `GET https://www.nexarda.com/api/v3/prices?type=game&id={nexardaId}&currency=EUR`
* **Intelligent Title Matching & Candidate Scoring (`src/server/sources/titleMatcher.ts`)**:
  * **Precision-First Matching ($\ge 95\%$ Accuracy Target)**: Combines Sørensen–Dice bigram character similarity with Jaccard word token overlap, release year verification, and anti-collision checks.
  * **Anti-Collision Sequel Protection**: Strict digit/Roman numeral cross-verification prevents cross-game false positives (e.g. *Max Payne* never matches *Max Payne 3*; *Dawn of War II* never matches *Dawn of War III*; *Trine* never matches *Trine 2*).
  * **Multi-Tier Query Variants**: Automatically generates canon search variants handling ampersand variations (`&` $\leftrightarrow$ `and`), Roman numerals (`VIII` $\leftrightarrow$ `8`), author prefixes (*Tom Clancy's*, *Sid Meier's*), edition suffixes (*Complete Edition*, *Anniversary Edition*, *Seekers Edition*, *Developer's Cut*), and multilingual slashes (*Valiant Hearts*).
  * **Self-Healing Anti-Poisoning**: If an existing stored `nexarda_id` returns a mismatched game title from the prices API (e.g. from an old naive scraper run), the adapter immediately clears the poisoned ID from both memory and the database and returns a safe fallback.
* **Rate Limits & Fair Use**:
  * Public access without API key requirement.
  * Adaptive pacing: Default `NEXARDA_DELAY_MS=500` (100ms jitter).
  * Auto-cooldown awareness: If upstream rate limit (429) occurs, respects `Retry-After` and enters circuit backoff.
* **Batch Resilience**:
  * During wishlist batch sweeps, individual game timeouts or active cooldowns skip the single game rather than aborting the remaining wishlist.

### 2.7 SuperDuperBundle (SDB)
* **Canonical Role**: High-speed, OpenAPI-compliant key price aggregator with multi-Steam-ID batching.
* **API Endpoints & Architecture**:
  * Single Game Lookup: `GET https://superduperbundle.com/api/v1/lookup/?steam_id={appId}&client=pricetool`
  * Bulk Batch Lookup: `GET https://superduperbundle.com/api/v1/lookup/?steam_ids={id1,id2,...,id50}&client=pricetool`
* **Currency & Offer Extraction Enhancements**:
  * **Dynamic Currency Support**: Normalizes and converts prices according to the payload's native `currency` field (e.g. `EUR`, `USD`, `GBP`) using live exchange rates, avoiding unintended currency distortions.
  * **Lowest Key Offer Fallback**: If a game's full `offers` array is empty or lacks alternative store coverage, the adapter automatically extracts and includes `lowest_steam_key` and Steam-compatible `lowest` offers.
* **Documented Quota Tiers & Rate Limits**:
  * **No key (Default)**: 600 uncached games per 10 minutes per IP address.
  * **Registered (Free Key)**: 2,500 games per 10 minutes (configured via `SUPERDUPERBUNDLE_API_KEY` / `X-API-Key` header).
  * **Partner**: 10,000 games per 10 minutes.
  * Headers: Evaluates `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` / `Retry-After`.
* **Batch Resilience & Adaptive Pacing**:
  * Bundles up to 50 Steam App IDs per batch request.
  * Pacing: Default `SUPERDUPERBUNDLE_DELAY_MS=1000` (200ms jitter).
  * Inter-Chunk Breathing Pause: Automatically pauses for `SUPERDUPERBUNDLE_CHUNK_PAUSE_MS=2500` every 10 chunks (500 games) to stay smoothly within the 600 games / 10-minute window.
  * Automatic Retry & Non-Aborting Fallback: Each chunk retries once on transient 5xx errors. If a chunk fails, it logs a warning, increments `failedChunks`, and continues with subsequent chunks rather than aborting the sync.

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
        ├── NEXARDA Worker        (Per-game find/search, Delay: 500ms, Jitter: 100ms)
        └── SuperDuperBundle Batch (50 AppIDs/req, Delay: 1000ms, Jitter: 200ms)
```
