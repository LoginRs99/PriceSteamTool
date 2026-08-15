# Changelog

All notable changes to the **Pricetool** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  * Added direct "View Deal" actions and clickable title links in `AnomaliesModal`.
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
