# Changelog

All notable changes to the **Pricetool** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2026-08-19

### Added
* **Grouped Data Safety & Price Glitch Review UI**:
  * Client-side grouped presentation in `AnomaliesView` organizing multiple flagged offers under clean, collapsible game cards with severity and count badges.
  * 1-click "Dismiss Game" batch dismissal alongside per-offer "View Deal" links and individual dismissals.
  * Preserved raw one-row-per-offer database write behavior in `anomalies` table for granular auditability and CSV exports.
* **AllKeyShop Stealth Pacing & Round-Robin Scheduling**:
  * Added fair round-robin sorting of due games by `allkeyshop_last_checked_at` ascending, eliminating starvation of lower-priority games across capped runs.
  * Safe default volume cap of 30 games per run (`ALLKEYSHOP_MAX_GAMES=30`), consistent across code, Docker Compose, and `.env.example`.
  * Replaced uniform random delay with exponential-tailed jitter (`calculateExponentialJitter`, capped at 3x) and occasional natural hesitation breaks (5–15 min, ~5% probability) to eliminate robotic periodic request patterns.
* **Dead Historical Snapshot Protection**:
  * Added 72h active observation window filtering to the AllKeyShop parser, preventing ancient historical sale logs (e.g. from delisted games) from overwriting live market prices.
* **Strict Non-Steam DRM Exclusion**:
  * Prioritized `isKnownNonSteamShop` DRM check over generic store flags to strictly prevent non-Steam shops (e.g. Epic Games Store) from being ingested as Steam keys.
* **Database Startup Column Migrations**:
  * Added safe `ALTER TABLE offers ADD COLUMN ...` migrations for `is_anomaly`, `anomaly_score`, and `anomaly_reason` to guarantee seamless database upgrades.

---

## [1.6.0] - 2026-08-19

### Added
* **Anti-Rate-Limit v1 REST API (`/api/v1/*`)**:
  * `POST /api/v1/offers/batch`: Batch pricing endpoint resolving up to 250 games in a single JSON payload.
  * `POST /api/v1/games/resolve`: Bulk game lookup resolving Steam AppIDs and title queries.
  * `GET /api/v1/games`: Catalog endpoint with pagination envelope and ETag `304 Not Modified` caching.
  * `GET /api/v1/games/:id`: Supports both internal UUID and `steam:<appId>` path parameter lookups.
  * `GET /api/v1/merchants`, `GET /api/v1/merchants/:id`, `POST / GET / DELETE /api/v1/alerts`, `GET /api/v1/quota`.
  * Standard IETF rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-API-Version`).
* **Database Performance & Composite Indexing**:
  * Added composite index `idx_offers_game_valid_price` on `offers(game_id, is_valid, price_eur)` for sort-free index scans and sub-millisecond price resolution.
* **Corroborated Sub-Euro Glitch Detection**:
  * Gated `SUB_EURO_PREMIUM_GLITCH` behind $\pm 30\%$ peer corroboration check (`SUB_EURO_PREMIUM_GLITCH_CORROBORATED`), eliminating false positives on legitimate multi-store sub-euro deals.
* **Data Safety Deduplication & CSV Export**:
  * Added complete 14-column spreadsheet CSV export (`GET /api/export/offers.csv`) with Export button in `AnomaliesView`.
* **Adaptive AllKeyShop Scheduling**:
  * Dynamic exponential check backoff (24h to 168h ceiling) for stable prices with fast-track target price override.
  * Rotating modern User-Agents with matching Chromium Client Hints (`Sec-CH-UA`).

---

## [1.4.0] - 2026-08-15

### Added
* **Strict Steam DRM Platform Filtering**:
  * Added rejection rules for non-Steam stores (GOG, Epic Games, Ubisoft Connect, Origin / EA App, Battle.net, DRM-Free) across ITAD, CheapShark, and AllKeyShop adapters.
  * Ensures 100% of tracked deals are valid Steam Keys, Steam Gifts, or direct Steam Store purchases.
* **Instant Boot Legacy Purge & Best Deal Re-election**:
  * Automated startup migration that drops non-Steam offers and reassigns canonical `is_best_deal` to lowest valid Steam offer on boot.
* **Clickable Anomalies with Direct Deal Links**:
  * Extended `Anomaly` model to join `deal_url`, `steam_app_id`, and `original_price_eur`.
  * Added direct "View Deal" actions and clickable title links in `AnomaliesView`.
* **Complete Quality-of-Life (QOL) Suite**:
  * Quick-search keyboard shortcuts (`/` and `Ctrl+K`).
  * 1-click search clear `(X)` button and "Reset filters" button.
  * Persistent user preferences via `localStorage` (View Mode, Sort Order, Page Size).
  * Quick jump pagination buttons (`<< First` and `Last >>`).
  * One-click "Copy Steam URL" button with tooltip feedback in `GameDetailModal`.
  * Floating animated "Scroll to Top" button for large wishlist views.
* **Database Query Performance Optimizations**:
  * Added composite SQLite indexes (`idx_games_free_dlc`, `idx_wishlist_active_priority`) for fast sub-millisecond pagination and filtering across 5,000+ games.

---

## [1.3.0] - 2026-08-15

### Added
* **Price Intelligence Engine (`priceIntelligence.ts`)**:
  * **Rolling Period Lows**: Tracks 7d, 30d, 90d, 1y, and confirmed ATL lows strictly from trusted offers, with explicit nullable fallback when data span is incomplete.
  * **Typical Sale Price**: Statistical IQR (Tukey's Fences) outlier filtering to compute the true historical median sale price without skew from glitches.
  * **BUY / FAIR / WAIT Recommendation Advisor**: Deterministic multi-stage decision tree with factual bullet-point reasoning and confidence rating.
  * **Sale Drop Frequency**: Evaluates discrete annual sale cycles with 14-day gap bridging and MSRP termination rules.
  * **Price Volatility (CV)**: Daily Best Trusted Price relative standard deviation calculated strictly across observed calendar days.
  * **Market Comparison**: Compares best price against all active, compatible regional offers (`GLOBAL`, `EU`, `HU`).
* **Interactive SVG Price History Chart (`PriceChart.tsx`)**:
  * Lightweight (< 5KB) pure SVG rendering with stepped price line, gradient area fill, MSRP baseline, ATL dashed line, and Typical Sale band.
  * Interactive hover tooltips showing date, merchant name, discount %, and Deal Score.
* **Consolidated Intelligence API**:
  * `GET /api/games/:id/intelligence` returning complete historical metrics and chart data in one query.
* **Enhanced Game Detail Modal**:
  * Redesigned with Buy/Fair/Wait decision hero banner, 5-card period low grid, price intelligence metric badges, interactive SVG chart, and complete offers table.

---

## [1.2.0] - 2026-08-15

### Added
* **Computed Deal Score (0–100)**:
  * 4-Pillar Deal Quality Engine (Discount Depth, Historical Record, Merchant Trust, Risk & Confidence Multiplier).
  * Strict -60 penalty and 35-point safety hard-cap for `HIGH` risk offers.
* **Best Deals Dashboard**:
  * Carousel/Grid showing the top-ranked deals sorted by Deal Score with tier badges (`Exceptional`, `Great`, `Fair`, `Weak`).
* **Wishlist Statistics Bar**:
  * Live stats for Total Wishlist Games, Active Sales, All-Time Lows, Major Drops, and Average Discount %.
* **Filter Bar**:
  * Major Deals filter ($\ge 50\%$ off or $\ge 15\text{ €}$ drop).
  * All-Time Low (ATL) filter.
  * Trusted Stores Only filter (official retailers + high-trust keyshops).
  * Interactive Maximum Price Range slider.

---

## [1.1.0] - 2026-08-15

### Added
* **Currency Correctness & Dynamic Exchange Rates**:
  * Preservation of raw source currency (`USD`, `GBP`, `HUF`, `EUR`) alongside normalized EUR price.
  * Daily cached ECB exchange rates with fallback rates.
* **Steam Wishlist Paginated Metadata Batching**:
  * High-efficiency batch fetching via `wishlistdata` endpoint with rate-limited pacing.
* **Canonical Offer Deduplication & Computed Source Agreement**:
  * `source_observations` table tracking multi-adapter provenance without duplicating store offers.
* **Price Freshness & Confidence Decay**:
  * Timestamps on every observation; stale data penalty applied gracefully without falsely inflating price risk.
* **Idempotent Price History Tracking**:
  * Deduplicated historical insertions only when price or discount actually changes.

---

## [1.0.0] - 2026-08-15

### Added
* **2D Pricing Engine Core**:
  * Multi-dimensional evaluation distinguishing price drop magnitude (`PriceEventType`) from data risk (`PriceRiskLevel`).
* **Multi-Source Adapter Architecture**:
  * Independent adapters for Steam, ITAD (v2/v3 batch), and CheapShark with token-bucket pacing and 4-state Circuit Breakers.
* **SQLite in WAL Mode**:
  * High-performance single-file transactional database with in-memory C++ prepared statement caching.
* **Modern React 19 Frontend**:
  * Fastify backend serving SPA with Server-Sent Events (SSE) for real-time synchronization progress.
