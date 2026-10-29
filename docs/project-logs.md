# 📜 PriceSteamTool — Comprehensive Project Logs & Engineering Ledger

> **Master Engineering Chronicle, Migration History, ADRs & Post-Mortems**  
> This document records the complete development history, version release logs, database migration ledger, architectural decisions, and critical incident post-mortems for **PriceSteamTool** (v1.0.0 through v2.8.2).

---

## 📑 Table of Contents

1. [Version Release History & Feature Logs (v1.0.0 – v2.8.2)](#1-version-release-history--feature-logs)
2. [Complete Database Migration Ledger (001 – 033)](#2-complete-database-migration-ledger)
3. [Architectural Decision Records (ADRs)](#3-architectural-decision-records)
4. [Incident Post-Mortems & Engineering Breakthroughs](#4-incident-post-mortems--engineering-breakthroughs)
5. [Test Suite Evolution & Quality Ledger](#5-test-suite-evolution--quality-ledger)

---

## 1. Version Release History & Feature Logs

### 🚀 v2.8.2 — Engineering Stabilization, Security Hardening & Proxy Routing (2026-10-28)
* **AllKeyShop Proxy Forwarding & Anti-Bot Shielding**:
  * Added `ALLKEYSHOP_PROXY_URL` parameter to route FlareSolverr requests through rotating HTTP/SOCKS5 proxies (such as Webshare `p.webshare.io:80`), completely shielding host IPs from Cloudflare WAF bans.
  * Added `ALLKEYSHOP_CHUNK_SIZE`, `ALLKEYSHOP_CHUNK_PAUSE_MS`, `ALLKEYSHOP_DELAY_MS`, and `ALLKEYSHOP_JITTER_MS` for human-like pacing during large catalog scrapes.
  * Configurable batch ceilings via `ALLKEYSHOP_MAX_GAMES=50` (default) and `ALLKEYSHOP_MAX_GAMES=0` (unlimited full catalog builds).
* **Security Hardening (CVE/CWE Mitigations)**:
  * CWE-1236: CSV Formula Injection protection prepending single quote to formula trigger characters (`=`, `+`, `-`, `@`).
  * CWE-918: Strict Discord webhook URL allowlisting and validation preventing internal SSRF attempts.
  * CWE-400/770: In-memory IP rate limiter memory bounds (`MAX_ENTRIES = 5000`) with LRU eviction preventing heap exhaustion.
* **Engineering Stabilization & Bug Fixes**:
  * URL encoded `steamId64` parameters preventing path traversal.
  * Robust unannounced and textual release date handling in `normalizer.ts`.
  * Clamped Discord 429 retry-after backoffs and added automated retry.
  * Fixed pagination parameters and `totalPages` calculation on `/api/v1/alerts`.
  * Expanded international currency normalization (TRY, KRW, PHP, INR, VND, RUB, UAH).
  * Test suite expanded to **84 test files, 815 tests (100% passing)**.

### 🚀 v2.8.1 — AllKeyShop Auto-TTL, On-Demand Catalog Refresh & Data Safety Backup (2026-10-20)
* **AllKeyShop 7-Day Auto TTL & On-Demand Catalog Refresh**:
  * Enforced automatic 7-day catalog expiration via `isCatalogFresh()`.
  * Added `POST /api/sources/allkeyshop/refresh-catalog` endpoint and interactive UI refresh button.
* **Point-in-Time Database Backup in Data Safety Tab**:
  * Added 1-click "Backup DB" manual action button with live status in `AnomaliesView.tsx`.
* **Database Optimization (Migration 033)**:
  * Added composite index `idx_offers_game_valid_anomaly` on `offers(game_id, is_valid, is_likely_pricing_error)`.

### 🚀 v2.8.0 — Multi-Buyer Filters, CheapShark Adaptive Pacing & Craft Polish (2026-10-20)
* **Multi-Buyer Filters & Game Selection Assistance**:
  * **Metacritic Filter (`minMetacritic`)**: Integrated numeric slider and quick filter pills to isolate high-scoring titles (e.g., 75+, 80+, 85+).
  * **Steam Review Sentiment Filter (`minSteamRating`)**: Direct filter for positive Steam user review percentage (e.g., 70%+, 80%+, 90%+ positive reviews).
  * **Below Typical Sale Filter (`belowTypicalSale`)**: Instant boolean filter targeting games currently discounted below their historical interquartile range (IQR) typical sale median.
  * **Buy Recommendation Filter (`buyRecommendationOnly`)**: Quick toggle filtering for deterministic `BUY` / `STRONG BUY` rated deals.
  * **Dynamic Server SQL Engine**: Added parameter-safe dynamic SQL clauses in `src/server/db/repositories/game.ts` to seamlessly compose all new filter constraints.
* **CheapShark API Resilience & Adaptive Rate Limiting**:
  * Resolved 429 rate limit errors and occasional network failures.
  * Re-architected batch querying to use adaptive chunking (`CHEAPSHARK_BATCH_CHUNK_SIZE = 25`) preventing request timeouts and URL length overflows.
  * Implemented exponential backoff with jitter on HTTP 429, 503, 504 in `fetchWithRetry`.
  * Added RFC 7231 HTTP-date and delta-seconds parsing in `parseRetryAfterHeader` and synchronized with source circuit breakers.
* **AllKeyShop Matching & Year/Edition Disambiguation**:
  * Fixed missing matches for franchise and reboot titles (such as *The Medium*, *Beast of Reincarnation*) by extracting and comparing release years, edition qualifiers, and multi-alias indices.
  * Fallback to pre-indexed compressed seed catalog ensures seamless matching without live Cloudflare stalls.
* **Universal Multi-Currency Localization**:
  * Replaced hardcoded euro symbols across `ActiveFilterBadges.tsx`, `AdvancedFiltersDrawer.tsx`, `QuickFilterPills.tsx`, `SourcesModal.tsx`, `IntelMetricsGrid.tsx`, and `ScoreExplainModal.tsx` with dynamic `formatPrice` from `useCurrency()`.
* **UX Craftsmanship & Anti-UI-Slop Polish**:
  * Replaced raw emoji soup with Lucide icons across `Navbar.tsx`, `AnomaliesView.tsx`, `SourcesModal.tsx`, `ScoreExplainModal.tsx`, and `TickerFlag.tsx`.
  * Preserved full target hit flag semantics and test suite compatibility.
  * Added clear educational tooltips for statistical metrics (IQR, price volatility, sample size, confidence) in `IntelMetricsGrid.tsx`.
  * Restructured `ScoreExplainModal.tsx` with visual cards breaking down the 4 Deal Score v2.4 pillars.
* **Test Suite Expansion**:
  * Added unit and integration tests across `FilterBar.test.tsx` and `wishlistFilterClause.test.ts`.
  * Test suite expanded to **84 test files, 806 tests (100% passing)**.

### 🚀 v2.7.1 — Fastify Schema-First, Anti-UI-Slop Craftsmanship & AllKeyShop Catalog Hardening (2026-10-18)
* **Fastify Best Practices & Schema-First API Architecture**:
  * Implemented Fastify JSON Schema-first route validation and serialization (`schema: { params, querystring, body, response }`) across `/api/health`, `/api/profiles`, `/api/purchases`, `/api/purchases/savings`, `/api/backup`, `/api/backups`, `/api/family-sharing/*`, and `/api/wishlist/:gameId/target-price`.
  * Response schemas compile with `fast-json-stringify`, boosting serialization throughput by 2–5x while stripping non-whitelisted attributes.
  * Central error handler in `src/server/index.ts` normalizes both Fastify native Ajv schema validation failures (`error.validation`) and Zod issues (`error.issues`) into standard error envelopes `{ error, statusCode, details }`.
* **Anti-UI-Slop & Zero-Layout-Shift Craftsmanship**:
  * Built `<SavingsSkeleton />` matching the exact geometry of KPI cards, monthly breakdowns, and dense transaction tables, eliminating Cumulative Layout Shift (CLS).
  * Upgraded React 19 `<Suspense>` boundaries in `App.tsx`: Free Games now mounts `<DenseTableSkeleton rows={8} />` and Savings Journal mounts `<SavingsSkeleton />`.
  * Created robust connection error boundary in `SavingsView.tsx` with alert banner and interactive "Retry Connection" button.
  * Replaced generic empty placeholder with a crafted onboarding empty state detailing step-by-step guidance for logging game purchases.
  * Enforced `fontVariantNumeric: 'tabular-nums'` across all monetary figures, discount percentages, and counters to eliminate horizontal character jitter.
* **Pre-Indexed Seed Catalog Provisioning (`src/server/sources/seed/allkeyshop_catalog.seed.json.gz`)**:
  * Bundled a 1.93 MB compressed seed catalog containing 204,453 verified AllKeyShop games and IDs.
  * Implemented instant offline cold-boot unpacking (<50ms), eliminating dependency on slow 11 MB live downloads through Cloudflare.
* **Franchise & Article Prefix Normalization**:
  * Added `stripPublisherPrefixes()` covering `Tom Clancy's`, `Sid Meier's`, `Warhammer 40,000`, `EA Sports`, `Marvel's`, `Disney's`, `The`, `A`, `An`.
  * Multi-alias indexing across raw clean name, Roman-to-Arabic numeral normalization, and franchise-stripped aliases in `AllKeyShopCatalogIndex`.
* **Fast-Path Numeric ID Price Ingestion**:
  * Refactored `fetchPricesForGame()` to make `price_history_api.php?normalised_name=${matched.id}` the primary fast path, avoiding 404 delays from guessed WordPress slugs.
* **Security & Rate-Limit Hardening (TDD)**:
  * Implemented `buildAksApiUrl()` with strict host allowlisting (`www.allkeyshop.com`) to prevent SSRF vulnerabilities.
  * Upgraded `parseRetryAfterHeader()` to parse both numeric seconds and RFC 7231 HTTP dates.
  * Isolated test runner directory configurations so unit tests never overwrite production catalog caches.
  * Full test suite expanded to **84 test files, 797 tests (100% passing)**.

### 🚀 v2.7.0 — Deal Intelligence, Savings Journal & Multi-Domain Resilience (2026-09-26)
* **Step 1: ATL Quarantine & Single-Source Data Integrity**:
  * Implemented defensive quarantine preventing single-source uncorroborated keyshop drops from immediately poisoning `games.historical_low_eur` and distorting typical sale medians.
  * Seeded ITAD price history records now evaluate dynamically through `evaluatePriceMovement` / `detectPricingError` instead of blindly trusting `is_pricing_error = 0`.
* **Step 2: DealScore Continuous Sigmoid & Geometric Mean Confidence**:
  * $S_{\text{atl}}$ pillar scales proportionally with discount depth relative to MSRP anchor (titles never discounted whose ATL $\approx$ MSRP no longer receive 36-point ATL bonuses).
  * Continuous sigmoid confidence ramp for sample counts and recency replacing abrupt step thresholds.
  * Weighted geometric mean across confidence factors with floor protection to prevent a single weak factor from zeroing overall confidence.
  * Stale multi-year drops undergo ATL age dampening.
* **Step 3: Anomaly User Feedback Loop**:
  * Added verification buttons in Data Safety view: *"Valódi hiba"* (Confirmed Error) vs *"Téves riasztás"* (False Positive).
  * Flagging as False Positive immediately unflags the offer and triggers instant recomputation of Best Deals.
  * Added per-merchant and per-signal accuracy tracking endpoints (`GET /api/anomalies/stats`, `POST /api/anomalies/:id/feedback`).
* **Step 4: Sync Resilience, Cooldowns & Batch Purging**:
  * Introduced `sync_runs` table and tracking repository to capture granular per-source sync metadata, statuses, and performance timings.
  * Cross-chunk circuit breaker cooldown preventing rapid retry thrashing on failing adapters.
  * Safe chunked deletion (1,000 items/chunk) in `purgeOldPriceHistory()` to avoid SQLite transaction locks.
* **Step 5: Database Hygiene & High-Performance Composite Indexes**:
  * Added composite indexes (`idx_wishlist_profile_active_priority`, `idx_offers_game_valid_error_price`) for instant wishlist rendering and best deal lookups.
  * Stored FX rate and audit timestamp in `source_observations.fx_rate` and `fx_rate_timestamp`.
  * Standardized EUR epsilon comparison (`EPSILON_EUR = 0.005`) and `isPriceEqual`/`isPriceDifferent` helpers.
  * Added automatic `PRAGMA optimize; ANALYZE;` post-sync optimization hook.
* **Step 7: Zero-Downtime SQLite Backup & Disaster Recovery**:
  * Online non-blocking SQLite backup engine leveraging `better-sqlite3` backup API with `PRAGMA wal_checkpoint(PASSIVE)`.
  * Post-backup integrity verification using `PRAGMA quick_check`.
  * Rolling 7-day retention rotation (`pricetool-backup-*.db`).
  * Automated 24h background backup scheduler and manual REST management endpoints (`POST /api/backup`, `GET /api/backups`).
* **Step 9: Megtakarítás-követő / Purchase Journal & Realized Savings Tracker**:
  * Log bought games directly from Offers table ("Megvettem" button) or dedicated Journal view.
  * Snapshots purchase price, historical MSRP, and typical sale median at the moment of purchase.
  * Realized savings analytics dashboard: total spent, savings vs MSRP, savings vs typical sale median, and monthly trends.
  * REST API endpoints: `GET/POST/DELETE /api/purchases`, `GET /api/purchases/savings`.

### 🚀 v2.6.0 — Multi-Currency with HUF, Smart Presets & Discord Actions (2026-09-18)
* **Live Multi-Currency Engine**:
  * Added client `CurrencyContext` with live conversion and localized formatting across all cards, compact rows, dashboards, offers tables, and flyout panels.
  * Native Hungarian Forint (`HUF`) support with integer separation and local currency symbol (e.g., `3 990 Ft`) with ~395.0 EUR fallback exchange rate.
  * Added `GET /api/exchange-rates` route exposing real-time multipliers from EUR.
  * 100% normalized database integrity: backend SQLite storage remains strictly in EUR; client converts user-entered target prices to EUR before saving.
* **Smart Target Price Presets**:
  * Quick-select target price recommendations in `TargetPriceEditor.tsx`:
    * 🟢 **Typical**: Sets target to the Tukey IQR typical sale median price.
    * 🔵 **Great (Q1)**: Sets target to the 25th percentile discount price.
    * 🟣 **Record Low**: Sets target to the confirmed historical all-time low.
* **Interactive Action-Oriented Discord Integration**:
  * Enhanced Discord deal alerts with direct actionable URLs: `[Buy on {Store}]` and `[View on Steam Store]`.
  * Rich embeds with deal score breakdowns, target price alerts, and new all-time low notifications.
* **Zero-Latency AllKeyShop Candidate Selector**:
  * Replaced blocking remote network fetch with memory/disk caching (`loadCatalogFromDiskOrMemory`) and 10s `AbortController` timeout.
* **Critical Bug Fixes**:
  * Drained all adapter queues upon `cancelSync()`, resolving HTTP 409 "Sync already in progress" locks.
  * Removed redundant `circuitBreakers.recordSuccess` and `recordFailure` in `orchestrator.ts:refreshGame()`.
  * Allowed `token` and `api_token` query parameters in SSE stream authentication.
  * Made `setActive(id)` atomic using `CASE WHEN id = ? THEN 1 ELSE 0 END`.
  * Guarded against `NaN` and negative `priceEur` poisoning in DealScore calculator.

### 🚀 v2.5.0 — Linear/Raycast Dark Theme & Slide-in Details Panel (2026-09-18)
* **Linear / Raycast Dark Aesthetic UI Redesign**:
  * Modern developer-centric dark design system with crisp 1px borders, subtle glass/translucent surface blur, and high-contrast semantic indicators.
  * JetBrains Mono typography for all numerical values.
  * Ergonomic high-density compact rows and visual grid cards.
* **Hybrid Split-View / Slide-in Details Panel**:
  * Slide-in right flyout details panel keeping wishlist visible and fully keyboard-navigable (`j`/`k`/`↑`/`↓`/`Enter`/`Esc`).
  * Mobile-first responsive touch layout (<768px) adapting flyout into a bottom sheet overlay.
* **Source Adapter Diagnostics & Self-Healing**:
  * Automatic note dismissal: `last_error` in SQLite and UI clears to `NULL` as soon as subsequent requests succeed.
  * Interactive Reset / Unpause button and `POST /api/sources/:code/reset` route.
  * Re-enabling any disabled source adapter automatically resets its circuit breaker state, consecutive failure counters, and backoff cooldowns.
* **AllKeyShop Scraper Resilience & Multi-Stage Fallback**:
  * Heavy live comparison timeouts gracefully fall back to lightweight JSON endpoint (`price_history_api.php`).
* **Inline Target Price Alert Card**:
  * Integrated directly into the game detail slide-in panel.
* **Pricing Error Engine Calibration**:
  * Protected legitimate keyshop deals by verifying historical precedent (`price >= atlEff - 0.05`).
  * Raised intra-source conflict ratio threshold for `price > 1.005 €` from 5.0x to 12.0x.

### 🚀 v2.4.0 — Family Sharing Exclusions & Pricing Intelligence (2026-09-17)
* **Steam Family Sharing Exclusions & Auto-Detection**:
  * Added database migration `027_add_family_sharing_exclusions`.
  * Wishlist listing and filtering automatically respect exclusions, ensuring third-party DRM games remain visible and trackable.
  * Added `checkFamilySharingSupport` leveraging official Steam Storefront Category 62 ("Family Sharing").
  * Added REST endpoints: `GET/POST /api/family-sharing/*`.
* **Pricing Intelligence Modernization (ADR-1 through ADR-4)**:
  * ADR-1: SOURCE_FAMILY_CONFLICT confined strictly to Keyshop tiers.
  * Approved 0.55 Lone Bottom Outlier Threshold (`currentPrice < secondCheapest * 0.55` with $\ge 2.00\text{ €}$ gap).
  * Restricted FAKE_BASELINE detection to offers below Steam base MSRP.
  * Calibrated DECIMAL_SHIFT & Sub-Euro Glitch Detection.
  * Purged 208 false positives and restored 708 legitimate offers at startup.
  * ADR-2 (OVER_MSRP informational signal), ADR-3 (Own-Type Median Discount), ADR-4 (Market Liquidity warning).
* **Scraper Guardrails & Phantom Price Elimination**:
  * Added validation in AllKeyShop parser eliminating phantom `0.02 EUR` pricing. Discards prices $\le 0.05\text{ EUR}$ across all sources.
* **API Reliability Hardening**:
  * CheapShark rate-limit resilience with strict single-request concurrency.
  * ITAD batch error isolation (failing 150-item chunks no longer abort successfully fetched chunks).

### 🚀 v2.3.0 — CheapShark Batching & Deal Score v2.3 (2026-09-13)
* **CheapShark True Multi-AppID Comma-Separated Batching**:
  * Bundles 25 Steam App IDs per comma-separated request (`/api/1.0/deals?steamAppID=id1,id2,...&pageSize=60`), reducing HTTP request volume by >90%.
  * Added pagination support up to 3 pages.
* **Epoch-Aware Rate Limit Header Parsing**:
  * Handles Unix epoch timestamps (> 1,000,000,000) from Cloudflare `X-RateLimit-Reset` and `ratelimit-reset` headers alongside integer seconds and HTTP-dates.
* **Best Deal Freshness Hierarchy & Instant ATL Auto-Reconciliation**:
  * Fresh safe offers ($\le 72\text{h}$) > Stale safe offers > Pricing errors excluded.
  * Instant automatic reconciliation of `historical_low_eur`, `historical_low_date`, and `historical_low_source`.

### 🚀 v2.2.0 — Diminishing-Returns Scoring & Metacritic (2026-09-12)
* **Deal Score v2.3 Power Curve**:
  * Replaced linear discount scoring with $30 \times ((\text{anchor} - \text{price})/\text{anchor})^{0.75}$.
  * Reserved Deal Score 100 exclusively for deals beating confirmed ATL by $\ge 5\%$.
  * Added provisional data sufficiency caps (40/65/80/85) for titles with sparse sample history (< 5 samples).
  * Added stale history cap (60) for observations older than 90 days.
* **Metacritic Critic Review Enrichment**:
  * Enriched `games.metacritic_score` and `games.metacritic_url` from CheapShark deal payloads.
* **Delisted Games Support**:
  * Added `games.is_delisted` flag to track removed titles.

### 🚀 v2.1.0 — Adapter Diagnostics & Safe Pacing (2026-09-12)
* Live diagnostic suite in `scripts/test-sources.ts`.
* Constant-time API token authentication check.
* Detailed preview snippets on unexpected HTML responses.

### 🚀 v2.0.0 — Pricing Error Architecture & Discord Glitch Hunter (2026-09-12)
* Dedicated `pricing_errors` table and backward-compatible `anomalies` view with `INSTEAD OF` triggers.
* Discord Glitch Hunter push notifications targeting the exact flagged offer URL.
* Non-blocking background price history seeding from ITAD.

### 🚀 v1.0.0 – v1.7.1 — Foundation, 2D Pricing Core & Anti-Rate-Limit v1 API
* Monolithic Fastify 5 + React 19 SPA + SQLite 3 in WAL mode.
* 4-State Circuit Breakers (`NORMAL` → `BACKOFF` → `PAUSED` → `COOLDOWN`).
* Token-bucket pacing queues for Steam, ITAD, CheapShark, GG.deals, and AllKeyShop.
* Public Anti-Rate-Limit v1 REST API (`/api/v1/offers/batch`, `/api/v1/games/resolve`, `/api/v1/games`).
* Steam Family Sharing library synchronization.
* 14-column spreadsheet CSV export (`GET /api/export/offers.csv`).

---

## 2. Complete Database Migration Ledger

The database migrations are managed sequentially in `src/server/db/migrations.ts` and executed inside an atomic transaction recorded in `schema_migrations`:

| Migration | Name | Description & Mutations | Safety & Invariant |
| :---: | :--- | :--- | :--- |
| **001** | `001_add_offers_risk_and_price_event_columns` | Added `price_event`, `risk_level`, `risk_score`, `risk_flags`, `evaluation_confidence` to `offers`. | Default values prevent NULL pointer exceptions. |
| **002** | `002_add_offers_raw_price_and_observation_columns` | Added `raw_price`, `raw_currency`, `raw_original_price`, `last_observed_at` to `offers`. | Preserves original source currency. |
| **003** | `003_add_offers_anomaly_columns` | Added `is_anomaly`, `anomaly_score`, `anomaly_reason` to `offers`. | Isolated risk flags. |
| **004** | `004_add_source_observations_and_price_history_columns` | Added `observed_raw_price`, `observed_currency` to `source_observations`; added `price_event`, `deal_score` to `price_history`. | Audit tracking. |
| **005** | `005_create_offers_indexes` | Added indexes on `offers(risk_level)`, `offers(price_event)`, `offers(game_id, is_valid, price_eur)`. | Sub-millisecond best deal filtering. |
| **006** | `006_add_games_statistical_deal_score_columns` | Added `typical_sale_median_eur`, `typical_sale_q1_eur`, `typical_sale_q3_eur`, `typical_sale_sample_count`, `typical_sale_low_confidence`, `low_90d_eur`, `low_1y_eur`, `atl_is_confirmed`, `atl_is_single_source_low`, `price_tracking_first_observed_at`, `best_offer_source_count`, `deal_score_stats_updated_at` to `games`. | Foundation for DealScore v2.3. |
| **007** | `007_add_allkeyshop_and_target_price_columns` | Added `allkeyshop_last_checked_at`, `allkeyshop_check_interval_hours`, `allkeyshop_unchanged_streak`, `allkeyshop_last_price_eur` to `games`; added `target_price_eur` to `wishlist_entries`. | Adaptive keyshop polling. |
| **008** | `008_cleanup_legacy_non_steam_offers` | Dropped non-Steam offers (GOG, Epic, Origin, Uplay, Battle.net) and recomputed best deals. | Enforces 100% Steam DRM integrity. |
| **009** | `009_create_steamdb_rating_and_history_indexes` | Added `steamdb_rating` to `games`; created indexes on `price_history(game_id, recorded_at)` and `wishlist_entries(priority)`. | Fast priority sorting. |
| **010** | `010_populate_steamdb_ratings` | Backfilled Bayesian Wilson scores for all existing games with review counts. | Normalized review sentiment. |
| **011** | `011_recompute_all_best_deals` | Executed catalog-wide `BEST_DEAL_RECOMPUTE_ALL_SQL`. | Reconciled stale best deal flags. |
| **012** | `012_add_price_history_seeded_at` | Added `price_history_seeded_at` to `games`. | Tracks ITAD historical seeding. |
| **013** | `013_ensure_anomaly_columns_and_recompute` | Idempotent guarantee for anomaly columns on `offers`. | Upgrade resilience. |
| **014** | `014_backfill_historical_lows_and_recompute` | Backfilled missing `historical_low_eur` from lowest valid historical observations. | Self-healing catalog data. |
| **015** | `015_drop_duplicate_indexes` | Cleaned up duplicate composite index definitions. | Query planner hygiene. |
| **016** | `016_add_family_sharing_support` | Added `is_family` flag to `profiles`; created `family_owned_apps` table. | Family library sharing support. |
| **017** | `017_ensure_target_price_eur` | Guaranteed existence of `target_price_eur` across all schemas. | Target price alert reliability. |
| **018** | `018_reconcile_historical_low_with_offers` | Automatically updated `historical_low_eur` where valid active offers undercut recorded ATL. | Real-time ATL synchronization. |
| **019** | `019_cleanup_anomalies_and_recompute_best_deals` | Dismissed false-positive anomalies and recomputed best deals. | Error hygiene. |
| **020** | `020_add_metacritic_columns` | Added `metacritic_score` and `metacritic_url` to `games`. | Enriched metadata via CheapShark. |
| **021** | `021_reconcile_catalog_historical_lows` | Swept entire database to heal discrepancy between games table and offers table lows. | Data consistency guarantee. |
| **022** | `022_add_pricing_errors_table_and_columns` | Created `pricing_errors` table; added `is_likely_pricing_error`, `pricing_error_confidence`, `pricing_error_type`, `pricing_error_reason` to `offers`; added `is_pricing_error` to `price_history`; created `steam_assets` table. | Modernized data safety architecture. |
| **023** | `023_drop_merchant_trust_score` | Dropped artificial trust score column from `merchants` table via table rewrite. | Eliminated synthetic subjective metric. |
| **024** | `024_post_migration_indexes_and_anomalies_view` | Created backward-compatible `anomalies` view with `INSTEAD OF` triggers and composite indexes. | Legacy API compatibility. |
| **025** | `025_add_games_is_delisted` | Added `is_delisted` flag to `games`. | Delisted title tracking. |
| **026** | `026_cleanup_false_sub_euro_glitches` | Dismissed false sub-euro errors on offers $\ge 1.005\text{ €}$, unflagged offers, and recomputed best deals. | Precision pricing-error calibration. |
| **027** | `027_add_family_sharing_exclusions` | Created `family_sharing_exclusions` table with Steam Category 62 auto-detection support. | Prevents hiding non-shareable games. |
| **028** | `028_composite_indexes_and_fx_audit` | Created `idx_wishlist_profile_active_priority`, `idx_offers_game_valid_error_price`; added `fx_rate` and `fx_rate_timestamp` to `source_observations`; created `sync_runs` table. | Index optimization & FX auditability. |
| **029** | `029_anomaly_feedback_loop` | Added `user_feedback` and `feedback_at` to `pricing_errors`; created `idx_pricing_errors_feedback`. | User confirmation/false-positive learning loop. |
| **030** | `030_purchases_and_savings_tracker` | Created `purchases` table with snapshots for MSRP, typical median, and savings; created indexing. | Realized savings journal. |
| **031** | `031_perf_indexes_and_best_deal_optimization` | Created high-performance composite indexes for sync runs, pricing error resolution, price history, and best deals. | Zero-lock query optimization. |
| **032** | `032_restore_uninvalidated_keyshop_offers` | Reconciled and restored valid active keyshop offers inadvertently marked invalid during prior migration sweeps. | Restores legitimate keyshop pricing. |
| **033** | `033_add_offers_game_valid_anomaly_index` | Added composite index `idx_offers_game_valid_anomaly` on `offers(game_id, is_valid, is_likely_pricing_error)`. | Accelerates candidate selection subqueries. |

---

## 3. Architectural Decision Records (ADRs)

### ADR-001: Monolithic Fastify 5 + React 19 Process vs Microservices
* **Status**: Accepted
* **Context**: The application must run efficiently on low-power personal hardware (Raspberry Pi 4/5, mini-PCs, NAS, unRAID) while aggregating thousands of games.
* **Decision**: Combine Fastify 5 REST API, background task scheduler, in-memory rate limit queues, and static SPA serving into a single Node.js 22 LTS process.
* **Consequences**: Zero inter-process latency, shared memory for rate-limit tokens, zero Docker network hop overhead, sub-100MB RSS memory footprint.

### ADR-002: SQLite in WAL Mode with C++ Statement Caching vs External Postgres
* **Status**: Accepted
* **Context**: Managing database configuration, connection pools, and container networking for an external database adds unnecessary maintenance burden.
* **Decision**: Use SQLite 3 via `better-sqlite3` with `PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`, `PRAGMA foreign_keys = ON`, and an LRU C++ prepared statement cache.
* **Consequences**: Single-file storage in `/data/pricetool.db`, concurrent read transactions never block writers, sub-millisecond query execution, zero external DB setup.

### ADR-003: Token-Bucket Paced Queues with Exponential Jitter vs Raw Concurrency
* **Status**: Accepted
* **Context**: Scraping or aggressively querying gaming stores results in temporary or permanent IP bans (Cloudflare 429/403 challenges).
* **Decision**: Every adapter operates through an isolated `PacedSourceQueue` enforcing strict inter-request delays (Steam 2000ms, ITAD 1000ms, CheapShark 1500ms, GG.deals 1500ms, AllKeyShop 2500ms) with exponential-tailed jitter.
* **Consequences**: Zero IP bans reported across months of testing; requests mirror human browsing patterns.

### ADR-004: CheapShark Multi-AppID Comma Batching (25x)
* **Status**: Accepted
* **Context**: CheapShark API was previously hit with 150 individual HTTP requests per sync cycle, causing occasional 429 rate limits.
* **Decision**: Bundle 25 Steam App IDs per comma-separated request (`/api/1.0/deals?steamAppID=id1,id2,...&pageSize=60`) with pagination up to 3 pages and Metacritic enrichment.
* **Consequences**: HTTP traffic reduced by >90% (150 requests reduced to 6 requests); completely eliminated 429 rate limiting.

### ADR-005: 4-Pillar Deal Score with Diminishing-Returns Power Curve
* **Status**: Accepted
* **Context**: Linear discount scoring prematurely saturated at 75% discounts and failed to reward authentic 80%–90% drops, while lacking protection against sparse historical data.
* **Decision**: Formulate $S_{\text{disc}} = 30 \times ((\text{anchor} - \text{price})/\text{anchor})^{0.75}$, reserve Score 100 exclusively for deals beating confirmed ATL by $\ge 5\%$, apply provisional history caps (40/65/80/85) when $<5$ samples exist, and cap stale history at 60.
* **Consequences**: Monotonic, mathematically transparent 0–100 score distinguishing genuine exceptional opportunities from routine repeating sales.

### ADR-006: Dedicated Pricing Error Architecture with Self-Healing
* **Status**: Accepted
* **Context**: Pricing glitches (e.g. €0.59 on a €60 game) falsely topped Best Deals lists and corrupted historical all-time low records.
* **Decision**: Create a dedicated `pricing_errors` table and `is_likely_pricing_error` flag on `offers`. Flagged offers are excluded from best deal selection. Automatic startup and post-sync sweeps dismiss resolved errors when prices rise or when cheaper valid deals exist.
* **Consequences**: Glitches never pollute Deal Scores or ATL records; manual maintenance is reduced to zero.

### ADR-007: Isolation of SOURCE_FAMILY_CONFLICT Strictly to Keyshop Tiers
* **Status**: Accepted
* **Context**: GG.deals occasionally reports a cheap keyshop deal and a high official price under the same aggregator payload. When flagged indiscriminately, official retail offers were mistakenly flagged as glitches.
* **Decision**: Confine `SOURCE_FAMILY_CONFLICT` strictly to Keyshop listings. Official retail offers are never flagged with this error. Furthermore, legitimate keyshop discounts on catalog games are exempt if the price is at or above a known confirmed low (`price >= atlEff - 0.05`).
* **Consequences**: Eliminated false-positive flags on valid retail promotions (e.g. *Divinity II*, *Terminator Resistance*).

### ADR-008: Steam Family Sharing Exclusions & Auto-Detection via Category 62
* **Status**: Accepted
* **Context**: Some games owned by family members cannot be shared due to publisher restrictions (EA Play, Ubisoft Connect, Rockstar Launcher). Filtering family games caused unshareable wishlist games to disappear.
* **Decision**: Create `family_sharing_exclusions` table and implement automated Steam Storefront Category 62 ("Family Sharing") checking.
* **Consequences**: Games that Steam prohibits from sharing remain visible and trackable on the user's active wishlist.

### ADR-009: Live Multi-Currency Engine with EUR Base Storage and Native HUF Support
* **Status**: Accepted
* **Context**: Users in Central Europe (Hungary) and other regions need native currency displays, but converting database values risks floating-point rounding errors and synchronization drift.
* **Decision**: Backend SQLite storage remains strictly in EUR (Single Source of Truth). Client `CurrencyContext` performs dynamic on-the-fly conversion for display, and converts user-entered target prices to EUR before sending to the server.
* **Consequences**: Total database integrity preserved while providing native `HUF` integer separation (`3 990 Ft`) and multi-currency flexibility.

### ADR-010: ATL Quarantine & Single-Source Integrity Shield
* **Status**: Accepted
* **Context**: A single unverified keyshop listing an implausible low could permanently overwrite `historical_low_eur`, poisoning historical metrics forever.
* **Decision**: Quarantine single-source unconfirmed new ATL offers from non-official sources until corroborated by multiple peers or verified by official retail stores.
* **Consequences**: Protects statistical typical sale medians and historical low records against unverified market noise.

### ADR-011: Zero-Downtime Online SQLite Backup Engine with Quick Check & Rolling Retention
* **Status**: Accepted
* **Context**: Copying SQLite database files while write transactions are active risks database corruption.
* **Decision**: Leverage `better-sqlite3` native online backup API (`db.backup()`) preceded by `PRAGMA wal_checkpoint(PASSIVE)` and verified immediately by `PRAGMA quick_check`. Maintain a rolling 7-day retention schedule.
* **Consequences**: Guaranteed corruption-free disaster recovery snapshots created in <50ms without taking the application offline.

### ADR-012: Purchase Journal & Realized Savings Tracker
* **Status**: Accepted
* **Context**: Users had no way to track which deals they actually bought or calculate how much money the platform saved them.
* **Decision**: Create a dedicated `purchases` table that snapshots purchase price, historical MSRP, and typical sale median at the exact moment of purchase, rendering interactive analytics in `SavingsView`.
* **Consequences**: Users receive concrete financial feedback on their cumulative savings versus full MSRP and standard repeating sales.

---

## 4. Incident Post-Mortems & Engineering Breakthroughs

### Incident 1: Sync Pipeline Cancellation Deadlock (Fixed in v2.6.0)
* **Symptom**: Clicking "Cancel Sync" left the background job stuck in a permanent running state. Subsequent sync attempts failed with HTTP 409 "Sync already in progress".
* **Root Cause**: While the orchestrator loop checked `isCancellationRequested`, child adapter queues (`allkeyshopQueue`, `pacedQueue`) continued awaiting in-flight delay timeouts. In-flight items were never purged from queue memory.
* **Resolution**: Implemented `.clear()` and active queue draining across all 5 adapters inside `cancelSync()`, immediately rejecting pending queue promises and resetting sync status to `IDLE`.

### Incident 2: Premature Circuit Breaker Tripping via Double-Recording (Fixed in v2.6.0)
* **Symptom**: Source adapters (particularly ITAD and Steam) occasionally tripped into `PAUSED` or `BACKOFF` mode after only 1 or 2 network timeouts, despite the configured threshold being 3 consecutive failures.
* **Root Cause**: `orchestrator.ts:refreshGame()` recorded success/failure on the circuit breaker, but the underlying adapter method (`fetchPrices`) *also* recorded the same outcome, incrementing consecutive failure counters by 2 for each failure.
* **Resolution**: Removed redundant calls in `orchestrator.ts`, delegating failure tracking strictly to the adapter boundary.

### Incident 3: SSE Stream Authentication Under Query Token Enforcement (Fixed in v2.6.0)
* **Symptom**: When `API_TOKEN` was enabled, the browser `EventSource` connection to `/api/sync/events` failed with HTTP 401 Unauthorized because native `EventSource` cannot send custom HTTP headers (`Authorization: Bearer ...`).
* **Root Cause**: Fastify auth hook only inspected the `Authorization` header.
* **Resolution**: Updated auth hook to accept `token` and `api_token` query parameters on SSE endpoints, validating tokens with timing-safe string comparison.

### Incident 4: Profile Bricking on Concurrent State Switch (Fixed in v2.6.0)
* **Symptom**: Rapidly clicking between Steam profiles could result in an invalid database state where zero profiles were marked as `is_active = 1`, breaking the frontend UI.
* **Root Cause**: Profile activation previously ran as two independent SQL statements: `UPDATE profiles SET is_active = 0` followed by `UPDATE profiles SET is_active = 1 WHERE id = ?`. If the second query failed or targeted an invalid ID, all profiles remained disabled.
* **Resolution**: Made profile switching an atomic single-statement update: `UPDATE profiles SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END`. Added profile existence verification and HTTP 404 return on invalid IDs.

### Incident 5: Phantom 0.02 EUR Keyshop Price Scrape (Fixed in v2.4.0)
* **Symptom**: Certain unreleased or delisted games suddenly displayed an AllKeyShop price of €0.02, triggering false Deal Score 99 alerts.
* **Root Cause**: When a game had no active offers, AllKeyShop's unofficial API returned placeholder metadata that the regex parser misidentified as a €0.02 voucher price.
* **Resolution**: Added validation discarding any price $\le 0.05\text{ EUR}$ across all adapters unless explicitly confirmed as a legitimate 100% off giveaway.

### Incident 6: Seeded ITAD Price History Contamination (Fixed in v2.7.0)
* **Symptom**: Importing historical price data from ITAD occasionally populated `games.historical_low_eur` with glitched legacy records that never underwent pricing error checks.
* **Root Cause**: The seeding pipeline inserted price history records with hardcoded `is_pricing_error = 0`.
* **Resolution**: Routed all historical price points through `evaluatePriceMovement` and `detectPricingError` during seeding, quarantining suspicious drops into `pricing_errors`.

### Incident 7: Residential IP Rate Limit & Cloudflare Ban during Full AllKeyShop Catalog Sync (Fixed in v2.8.2)
* **Symptom**: Initiating a full sync on a 1,288-game wishlist triggered Cloudflare WAF rate limiting and residential IP bans against `allkeyshop.com`.
* **Root Cause**: Force full refresh previously queued all 1,288 games in an unbounded run from the host's single home IP without proxy forwarding or inter-chunk pauses.
* **Resolution**: Added `ALLKEYSHOP_PROXY_URL` to route FlareSolverr requests through rotating proxies (such as Webshare `p.webshare.io:80`), introduced chunked pacing (`ALLKEYSHOP_CHUNK_SIZE=25`, `ALLKEYSHOP_CHUNK_PAUSE_MS=180000`, `ALLKEYSHOP_JITTER_MS=1500`), and set `ALLKEYSHOP_MAX_GAMES=50` default ceiling while supporting `ALLKEYSHOP_MAX_GAMES=0` for safely spaced initial catalog seeding.

---

## 5. Test Suite Evolution & Quality Ledger

### Test Growth Trajectory
* **v1.0.0**: 12 test files, 60 unit tests.
* **v1.6.0**: 28 test files, 210 unit & integration tests.
* **v2.0.0**: 45 test files, 410 tests.
* **v2.3.0**: 68 test files, 624 tests.
* **v2.5.0**: 74 test files, 680 tests.
* **v2.7.0**: 82 test files, 776 automated tests.
* **v2.8.2 (Current)**: **84 test files, 815 automated tests passing cleanly (100%) in 97s**.

### Key Test Suites & Regressions Guarded
1. `tests/unit/dealScore.test.ts` (51 tests): Verifies 4 pillars, diminishing-returns curve, provisional caps, score 100 reservation.
2. `tests/unit/pricingEngine.test.ts` (65 tests): Verifies all 8 pricing error types, threshold calibration, and independent peer corroboration.
3. `tests/unit/atlConfirmationIntegrity.test.ts` (12 tests): Verifies ATL quarantine, single-source rejection, and official store confirmation.
4. `tests/unit/circuitBreaker.test.ts` (9 tests): Verifies 4-state state machine, backoff intervals, and error clearing.
5. `tests/unit/backup.test.ts`: Verifies zero-downtime online SQLite backup, `quick_check` validation, and rolling 7-day retention.
6. `tests/integration/mutatingRoutesValidation.test.ts`: Verifies REST API input sanitization, error responses, and state mutations.
7. `tests/client/App.test.tsx` & `tests/client/GameDetailModal.test.tsx`: Verifies React 19 UI component rendering, keyboard shortcuts, and modal interactions.

---

*This engineering ledger is maintained with every major and minor release of PriceSteamTool.*
