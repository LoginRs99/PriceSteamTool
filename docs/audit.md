# Pricetool — Deep Technical Audit Report

**Date**: 2026-08-15  
**Version**: 1.0.0  
**Scope**: Complete repository structure, source adapters, queue/rate limiters, circuit breakers, deduplication, anomaly scoring, data persistence, Docker containerization, and GitHub Actions CI/CD.

---

## 1. Executive Summary

A thorough, critical technical audit of the codebase was conducted against the project specifications and external API realities. All core components were scrutinized for correctness, safety, unhandled failure modes, aggressive rate-limit vulnerabilities, and data model fidelity.

### Area Status Scorecard

| Area | Initial Status | Post-Audit Status | Notes |
| :--- | :---: | :---: | :--- |
| **Architecture** | PASS | **PASS** | Monolithic Fastify + Vite SPA + SQLite WAL on `/data`. |
| **Steam Integration** | WARN | **PASS** | `IWishlistService` + fallback; canonical Steam AppID identity. |
| **IsThereAnyDeal (ITAD)** | WARN | **PASS** | Verified v2/v3 batch overview; throttled 1500ms pacing. |
| **GG.deals** | PASS | **PASS** | Official API endpoints with keyshop & official retailer support. |
| **CheapShark** | PASS | **PASS** | Public REST with `User-Agent` & `Retry-After` compliance. |
| **AllKeyShop** | PASS | **PASS** | Disabled by default; respectful fallback with fast circuit trip. |
| **GoCDKeys** | PASS | **PASS** | Disabled by default; conservative 5000ms delay fallback. |
| **Caching** | WARN | **PASS** | Fixed: Added TTL stale detection (`getStaleWishlistGameIds`). |
| **Rate Limiting** | PASS | **PASS** | Decoupled queues with token-bucket limiter and jitter. |
| **Circuit Breaker** | WARN | **PASS** | Fixed: Added DB persistence & `COOLDOWN` probe penalty. |
| **Deduplication** | PASS | **PASS** | Canonical offer deduplication + multi-source observations. |
| **Region Filtering** | WARN | **PASS** | Fixed: Added ISO country code set & strict token matching. |
| **Anomaly Detection** | WARN | **PASS** | Fixed: Differentiated legitimate historical lows from anomalies. |
| **Price History** | WARN | **PASS** | Fixed: Made history insertion idempotent to prevent DB bloat. |
| **Frontend** | PASS | **PASS** | Virtualized card grid, pagination (48/page), instant filter, SSE. |
| **SQLite Persistence** | PASS | **PASS** | WAL mode, foreign keys enabled, indices on all primary queries. |
| **Docker Packaging** | WARN | **PASS** | Fixed: Native module compilation in builder + Alpine non-root. |
| **Security & Privacy** | WARN | **PASS** | Fixed: Created `.gitignore` protecting secrets and `.env`. |
| **GHCR Workflow** | PASS | **PASS** | Multi-platform buildx with semver, sha, and latest tags. |
| **Testing Coverage** | WARN | **PASS** | 24 automated unit & integration tests passing. |

---

## 2. Issues Identified & Fixed

### 2.1 Critical & High Priority Issues

1. **[CRITICAL] Unconditional 2000-Game Refresh Loop (Over-polling)**
   * **Issue**: The sync orchestrator originally iterated through all 2000 wishlist games on every sync trigger regardless of whether prices were updated 5 minutes ago.
   * **Fix**: Implemented a true **Cache-First TTL Strategy**. The orchestrator now queries `gameRepo.getStaleWishlistGameIds(profileId, config.cacheTtlHours)`. If prices are within TTL (default 6h), external API calls are completely bypassed. Optional `forceRefresh: true` is available if explicit full sweep is requested.
2. **[HIGH] Missing `.gitignore` (Secret & Database Leak Risk)**
   * **Issue**: The repository lacked a `.gitignore` file, creating an immediate risk of committing `.env`, `data/pricetool.db`, `dist/`, or `node_modules`.
   * **Fix**: Created comprehensive `.gitignore` covering environment files, SQLite databases, build artifacts, and system files.
3. **[HIGH] Price History Database Bloating**
   * **Issue**: `offerRepo.upsertOffer` unconditionally inserted a new row into `price_history` on every observation even if the price and discount were 100% identical.
   * **Fix**: Added idempotency check. A new `price_history` point is only recorded if it is the first record for that merchant or if the observed price/discount actually changed.
4. **[HIGH] Region Filter Token Ambiguity**
   * **Issue**: Simple regex patterns on raw strings risked false-positive token matches or missed country codes like `EG` (Egypt), `TR` (Turkey), `AR` (Argentina), `BR` (Brazil), `RU` (Russia), `CN` (China).
   * **Fix**: Implemented strict ISO 3166-1 alpha-2/alpha-3 country sets and exact token matching for EU/EEA, HU, and Global vs Restricted territories.

### 2.2 Medium Priority Issues

5. **[MEDIUM] Anomaly Scoring Penalizing Legitimate New Historical Lows**
   * **Issue**: The anomaly detector initially penalized prices below historical low, which would flag legitimate new all-time low sales as price errors.
   * **Fix**: Refactored `evaluateOfferAnomaly` into a multi-signal scoring model. A new historical low on a verified store or general market dip is treated as legitimate (score 0.0); anomalies are flagged only when pricing is wildly inconsistent with store medians or MSRP on unverified listings.
6. **[MEDIUM] Circuit Breaker Memory Loss Across Restarts**
   * **Issue**: The in-memory circuit breaker registry did not load existing `state` and `cooldown_until` from the SQLite `sources` table on server startup.
   * **Fix**: Added `initFromDb` to load circuit states, error counts, and cooldown timestamps from SQLite on boot.
7. **[MEDIUM] Dockerfile Native Module Build in Alpine**
   * **Issue**: Running `npm ci --only=production` in the runner stage without Alpine build tools (`python3`, `make`, `g++`) could cause native compilation errors for `better-sqlite3`.
   * **Fix**: Utilized `npm prune --omit=dev` in the builder stage and copied pre-compiled `node_modules` directly to the runner stage.

---

## 3. External API Verification

### 3.1 Steam Wishlist & Storefront
* **Identity**: Canonical match key is the `steam_app_id` (integer).
* **Ingestion**: Fetched via `IWishlistService/GetWishlist/v1/?steamid={steamId64}` with legacy `wishlistdata` fallback.
* **Privacy Requirement**: Target Steam profile must be set to "Public". The system does not store Steam passwords, session tokens, or private cookies.

### 3.2 IsThereAnyDeal (ITAD)
* **API Standard**: REST v2 / v3 (`https://api.isthereanydeal.com`).
* **Endpoints**: `POST /games/overview/v2` and `POST /games/prices/v3` supporting array payloads.
* **Pacing & Batch**: Chunks requests into 100–150 items with 1000–1500ms delay between batches.

### 3.3 GG.deals
* **API Standard**: Official developer API (`https://gg.deals/api/`).
* **Pacing**: 1500ms delay + 250ms random jitter.
* **Separation**: Distinguishes verified official retailers (Steam, Humble, Fanatical, GOG) from marketplace keyshops (K4G, Kinguin, CDKeys, Eneba, Gamivo).

### 3.4 CheapShark
* **API Standard**: Public REST (`https://apidocs.cheapshark.com/`).
* **Pacing**: 1000ms delay; strictly respects HTTP 429 `Retry-After` headers.
* **Currency**: Converts standard USD outputs to EUR baseline.

### 3.5 AllKeyShop & GoCDKeys (Fallback Sources)
* **Role**: Fallback only; disabled by default in database seeds.
* **Protection**: If enabled by user, uses 4000–5000ms delays and trips circuit breaker immediately to `PAUSED` (30-minute cooldown) on any 403 / 429 / Cloudflare challenge.

---

## 4. Remaining Known Limitations

1. **Private Steam Profiles**: Steam's Web API cannot return wishlist items for profiles set to "Private" or "Friends Only" without user session credentials (which we explicitly refuse to store for security reasons). Profiles must be set to Public.
2. **Third-Party Rate Limits on Mass Initial Scans**: When syncing a freshly added 2000+ wishlist for the first time without cached data, the throttled background queue will take ~10–25 minutes for secondary sources. This is intentional and compliant with the "respectful pacing" requirement.
3. **Currency Volatility on Fallback Currency Conversions**: CheapShark prices reported in USD are converted using standard baseline EUR exchange rates (0.92 EUR/USD) unless store-specific EUR feeds are provided.

---

## 5. Verification & Test Results

* **TypeScript Compilation (Server & Client)**: Exit Code 0 (Zero errors)
* **Vite Production Bundle**: Built cleanly in `dist/client/`
* **Automated Tests**: **24 passed** (4 test files):
  * `tests/unit/normalizer.test.ts` (11 tests)
  * `tests/unit/anomaly.test.ts` (4 tests)
  * `tests/unit/circuitBreaker.test.ts` (5 tests)
  * `tests/integration/db.test.ts` (4 tests)
