# Changelog

All notable changes to the **Pricetool** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.8.2] - 2026-10-28

### Added
* **AllKeyShop Proxy Forwarding Support via FlareSolverr**:
  * Added `ALLKEYSHOP_PROXY_URL` (`ALLKEYSHOP_PROXY`) configuration parameter to forward HTTP/SOCKS5 rotating proxies (e.g., Webshare `http://user:pass@p.webshare.io:80`) directly through FlareSolverr's `/v1` request payload.
  * Masks host residential IPs during background key enrichment, completely preventing Cloudflare IP bans and WAF challenges.
* **Configurable Batching & Stealth Full Scrape Support**:
  * Added `ALLKEYSHOP_CHUNK_SIZE`, `ALLKEYSHOP_CHUNK_PAUSE_MS`, `ALLKEYSHOP_DELAY_MS`, and `ALLKEYSHOP_JITTER_MS` to pace large scrapes with human-like timing.
  * Added support for `ALLKEYSHOP_MAX_GAMES=0` allowing users to explicitly opt into unlimited catalog scraping for initial full database seeding across 1,000+ games.

### Security
* **CWE-1236 CSV Formula Injection Mitigation**:
  * Sanitized CSV exports in `escapeCsvCell` (`src/server/routes/api.ts`) by prepending a single quote (`'`) to values starting with formula trigger characters (`=`, `+`, `-`, `@`, `\t`, `\r`).
* **CWE-918 SSRF Mitigation in Discord Webhook Configuration**:
  * Enforced strict validation (`isValidDiscordWebhookUrl`) on `POST /api/settings/discord` and `saveDiscordSettings` (`discordNotifier.ts`), prohibiting internal addresses or arbitrary external origins from being persisted.
* **In-Memory Rate Limiter Resource Protection (CWE-400 / CWE-770)**:
  * Enforced a hard capacity ceiling (`MAX_ENTRIES = 5000`) with LRU/oldest-entry eviction in `rateLimit.ts` to prevent unbounded memory growth and heap exhaustion from distributed/spoofed IP headers.

### Fixed & Stabilized
* **Steam ID Parameter Encoding & Path Traversal Prevention**:
  * Encoded `steamId64` with `encodeURIComponent` across Steam Storefront wishlist pagination and Steam Web API request paths (`steam.ts`).
* **Unannounced & Textual Release Date Normalization**:
  * Enhanced `normalizer.ts` with `isGameUnreleased` and `isGameDelisted` to reliably handle non-standard text strings returned by Steam (e.g. `"Coming soon"`, `"TBA"`, `"To be announced"`, `"Upcoming"`).
  * Unified game and offer repository row mappers (`game.ts`, `offer.ts`) to avoid misidentifying unreleased titles as released games.
* **Safe Timestamp Slicing & Exception Prevention in Price Intelligence**:
  * Replaced unsafe direct `.slice(0, 10)` invocations on `recorded_at` in `volatility.ts` and `chartData.ts` with null-safe fallbacks, preventing unhandled `TypeError` crashes during price intelligence queries on incomplete historical data.
* **Ongoing Steam Seasonal Sales Detection**:
  * Added active sale duration tracking in `seasonalSales.ts` (`isOngoing: true`, `daysUntil: 0`) ensuring ongoing major Steam sales (Autumn, Winter, Spring, Summer) are correctly recognized rather than skipped until the following year's event.
* **Discord Webhook 429 Rate-Limit Retry Handling**:
  * Clamped Discord `retry_after` header backoffs to a bounded operational window (`[500, 15000]` ms) and added an automatic retry in `discordNotifier.ts` to prevent deal notification loss under transient Discord rate limits.
* **Pagination Parameters in `/api/v1/alerts`**:
  * Corrected `GET /api/v1/alerts` in `v1.ts` to respect `page` and `limit` query parameters with accurate `totalPages` metadata matching the v1 OpenAPI specification.
* **Global Currency Normalization**:
  * Expanded `exchangeRate.ts` (`normalizeCurrencyCode`) to support international currency symbols: `₺`/`TL` (TRY), `₩` (KRW), `₱` (PHP), `₹` (INR), `₫` (VND), `₽`/`РУБ` (RUB), and `₴` (UAH).

## [2.8.1] - 2026-10-20

### Added
* **AllKeyShop 7-Day Auto TTL & On-Demand Catalog Refresh**:
  * Enforced automatic 7-day catalog expiration (`CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000`) via `isCatalogFresh()`, ensuring stale AllKeyShop master title indexes are regularly refreshed.
  * Added `POST /api/sources/allkeyshop/refresh-catalog` endpoint to manually trigger a fresh catalog re-download.
  * Added interactive "Update Catalog" button with live status badge in the Source Adapters modal (`SourcesModal.tsx`).
* **Point-in-Time Database Backup in Data Safety Tab**:
  * Added a dedicated "Backup DB" manual action button with progress spinner and status alert banner in `AnomaliesView.tsx`.
  * Integrates directly with `POST /api/backup` for instant zero-downtime database snapshots before inspecting or modifying data.
* **Database Optimization (Migration 033)**:
  * Added index `idx_offers_game_valid_anomaly` on `offers(game_id, is_valid, is_likely_pricing_error)` to accelerate candidate selection and anomaly subqueries.

### Fixed
* **Filter Parameter Serialization & Target Reached Filtering**:
  * Wired `targetReachedOnly`, `actionDecision`, and `priceEvent` filter parameters across client API requests (`api.ts`) and backend route query parsing (`api.ts` and `v1.ts`).
  * The "🎯 Target Reached" quick-filter pill now accurately isolates games whose best offer is at or below the user's custom target price.
* **Filter Reset & Empty-State Alignment**:
  * Expanded `hasActiveFilters` and `handleResetFilters` in `App.tsx` to include `minMetacritic`, `minSteamRating`, `belowTypicalSaleOnly`, `underPrice`, and `hidePricingErrors`, ensuring filters are cleanly cleared in empty state and drawer reset actions.

## [2.8.0] - 2026-10-20

### Added
* **Multi-Buyer Filters & Game Selection Assistance**:
  * **Metacritic Score Filter**: Min Metacritic score slider and quick filter pills to isolate critically acclaimed titles.
  * **Steam Review Sentiment Filter**: Filter wishlist by minimum Steam user review sentiment percentage (e.g. 70%+, 80%+, 90%+ positive).
  * **Below Typical Sale Filter**: Instant filter toggle isolating games currently discounted below their historical interquartile range (IQR) typical sale price median.
  * **Buy Recommendation Filter**: Dedicated toggle to isolate deterministic `BUY` / `STRONG BUY` rated deals.
  * Dynamic backend SQL generation in `src/server/db/repositories/game.ts` supporting all new filter clauses seamlessly with existing priority, store, and price constraints.
* **CheapShark API Resilience & Adaptive Rate Limiting**:
  * Implemented adaptive chunking (`CHEAPSHARK_BATCH_CHUNK_SIZE = 25`) preventing request timeouts and URI length limitations.
  * Resilient backoff with exponential retry & jitter on HTTP 429, 503, 504 and transient network drops in `fetchWithRetry`.
  * Dynamic `Retry-After` header parsing (supporting both delta-seconds and HTTP-date formats) and source circuit breaker integration.
* **AllKeyShop Matching & Year/Edition Disambiguation**:
  * Enhanced candidate title matching in `allkeyshop.ts` to disambiguate release years (e.g., *The Medium*, *Beast of Reincarnation*), multi-word roman numerals, and edition suffixes (*Standard Edition*, *Deluxe*, *Remastered*).
  * Robust fallback to pre-indexed seed catalog preventing live Cloudflare lookup stalls.
* **Universal Multi-Currency Support**:
  * Dynamic localized currency formatting (`useCurrency()`) replaces hardcoded euro symbols across `ActiveFilterBadges.tsx`, `AdvancedFiltersDrawer.tsx`, `QuickFilterPills.tsx`, `SourcesModal.tsx`, `IntelMetricsGrid.tsx`, and `ScoreExplainModal.tsx`.
* **UX Craftsmanship & Anti-UI-Slop Polish**:
  * Replaced inconsistent emoji iconography with clean, semantic Lucide icons in `Navbar.tsx`, `AnomaliesView.tsx`, `SourcesModal.tsx`, `ScoreExplainModal.tsx`, and `TickerFlag.tsx`.
  * Added rich explanation tooltips demystifying IQR, price volatility, sample size, and confidence metrics in `IntelMetricsGrid.tsx`.
  * Redesigned `ScoreExplainModal.tsx` with dedicated cards breaking down the 4 Deal Score v2.4 pillars ($S_{\text{atl}}$, $S_{\text{cur}}$, $S_{\text{med}}$, $S_{\text{pos}}$).

### Changed & Fixed
* Updated client filter test suite (`FilterBar.test.tsx`) and unit test suite (`wishlistFilterClause.test.ts`) covering all new filter permutations (84 test files, 806 tests, 100% pass).
* Resolved dead imports and unused variables across client and server modules.

## [2.7.1] - 2026-10-18

### Added
* **Fastify Schema-First Route Validation**: Native JSON Schema validation and serialization across API endpoints.
* **Seed Catalog Provisioning**: Bundled compressed AllKeyShop seed catalog (`allkeyshop_catalog.seed.json.gz`) for sub-50ms cold boots.
* **Anti-UI-Slop Craftsmanship**: Added zero-layout-shift skeletons (`SavingsSkeleton`), connection error boundaries, and `tabular-nums` formatting.

## [2.7.0] - 2026-09-26

### Added
* **ATL Quarantine & Single-Source Data Integrity (Step 1)**:
  * Seeded ITAD price history rows now evaluate through `evaluatePriceMovement` / `detectPricingError` instead of hardcoding `is_pricing_error = 0`.
  * Single-source unconfirmed new all-time low (ATL) offers from non-official sources are quarantined from immediately overwriting `games.historical_low_eur` and corrupting typical sale medians until corroborated or confirmed by official stores.
* **DealScore & Confidence Calibration (Step 2)**:
  * $S_{\text{atl}}$ pillar scales proportionally with discount depth relative to MSRP anchor (never-discounted games with ATL $\approx$ MSRP now receive low/zero $S_{\text{atl}}$ score).
  * Continuous sigmoid confidence ramp for sample counts and sample recency replacing abrupt step thresholds.
  * Weighted geometric mean across confidence factors with floor protection to prevent a single weak factor from zeroing overall confidence.
  * ATL age dampening prevents stale multi-year drops from unfairly topping deal scores.
* **Anomaly Feedback Loop (Step 3)**:
  * User verification in Anomaly view: "Valódi hiba" (Confirmed Error) vs "Téves riasztás" (False Positive).
  * False positives automatically unflag the offer and trigger instant recomputation of Best Deals.
  * Per-merchant and per-signal accuracy tracking endpoints (`GET /api/anomalies/stats`, `POST /api/anomalies/:id/feedback`).
* **Sync Resilience, Cooldowns & Batch Purging (Step 4)**:
  * Introduced `sync_runs` table and tracking repository to capture granular per-source sync metadata, statuses, and performance timings.
  * Cross-chunk circuit breaker cooldown preventing rapid retry thrashing on failing adapters.
  * Safe chunked deletion (1000 items/chunk) in `purgeOldPriceHistory()` to avoid SQLite transaction locks.
* **Database Hygiene & High-Performance Composite Indexes (Step 5)**:
  * Composite indexes (`idx_wishlist_profile_active_priority`, `idx_offers_game_valid_error_price`) for instant wishlist rendering and best deal lookups.
  * Stored FX rate and audit timestamp in `source_observations.fx_rate` and `fx_rate_timestamp`.
  * Standardized EUR epsilon comparison (`EPSILON_EUR = 0.005`) and `isPriceEqual`/`isPriceDifferent` helpers.
  * Automatic `PRAGMA optimize; ANALYZE;` post-sync optimization hook.
* **Zero-Downtime SQLite Backup & Disaster Recovery (Step 7)**:
  * Non-blocking online SQLite backup engine leveraging `better-sqlite3` backup API with `PRAGMA wal_checkpoint(PASSIVE)`.
  * Post-backup integrity verification using `PRAGMA quick_check`.
  * Rolling 7-day retention rotation (`pricetool-backup-*.db`).
  * Automated 24h background backup scheduler and manual REST management endpoints (`POST /api/backup`, `GET /api/backups`).
  * Complete operational disaster recovery documentation in `docs/backup-restore.md`.
* **Megtakarítás-követő / Purchase Journal & Realized Savings Tracker (Step 9)**:
  * Log bought games directly from Offers table ("Megvettem" button) or dedicated Journal.
  * Snapshots purchase price, historical MSRP, and typical sale median at the moment of purchase.
  * Realized savings analytics dashboard: total spent, savings vs MSRP, savings vs typical sale median, and monthly trends.
  * REST API endpoints: `GET/POST/DELETE /api/purchases`, `GET /api/purchases/savings`.

### Changed & Fixed
* **Frontend Surfacing & UI Cleanup (Step 8 & 10)**:
  * Surfaced `marketDepthCaveat` in DealScore tooltip and details hero.
  * Rendered confidence breakdown indicators and visual tooltips.
  * Cleaned up deprecated and unused `DenseTableView.tsx`.
  * Fixed Steam / ITAD 0-priced giveaways handling so they remain properly classified.
  * Hardened CheapShark / GGDeals adapter error reporting and currency parsing.

## [2.6.0] - 2026-09-18

### Added
* **Live Multi-Currency Display (EUR, USD, GBP, CAD, AUD, HUF)**:
  * Added client `CurrencyContext` with live conversion and localized formatting across all cards, compact rows, dashboards, offers tables, and intelligence flyout panels.
  * Native Hungarian Forint (`HUF`) support with integer separation and local currency symbol (e.g., `3 990 Ft`) with ~395.0 EUR fallback exchange rate.
  * Added `GET /api/exchange-rates` route in Fastify server exposing real-time multipliers from EUR.
  * 100% normalized database integrity: backend SQLite storage remains strictly in EUR; client converts user-entered target prices to EUR before saving.
* **Smart Target Price Presets**:
  * Added quick-select target price recommendations in `TargetPriceEditor.tsx`:
    * 🟢 **Typical**: Sets target to the Tukey IQR typical sale median price.
    * 🔵 **Great (Q1)**: Sets target to the 25th percentile discount price.
    * 🟣 **Record Low**: Sets target to the confirmed historical all-time low.
  * Auto-converts values to the user's active display currency.
* **Interactive Action-Oriented Discord Integration**:
  * Enhanced Discord deal alerts with direct actionable URLs: direct purchase link (`[Buy on {Store}]`) and Steam storefront (`[View on Steam Store]`).
  * Enriched embeds with deal score breakdowns, target price alerts, and new all-time low notifications.
* **Zero-Latency AllKeyShop Candidate Selector**:
  * Replaced blocking remote network fetch with memory/disk caching (`loadCatalogFromDiskOrMemory`) and added a 10s `AbortController` timeout, eliminating candidate loading freezes.

### Fixed
* **Sync Pipeline Deadlock & Cancel Hang**:
  * Drained all adapter queues (`allkeyshopQueue`, `steamAdapter`, `itadAdapter`, `cheapsharkAdapter`, `ggdealsAdapter`) upon `cancelSync()`, resolving HTTP 409 "Sync already in progress" locks.
* **Double-Recording Failure Bug**:
  * Removed redundant `circuitBreakers.recordSuccess` and `recordFailure` calls in `orchestrator.ts:refreshGame()`, preventing single network hiccups from tripping circuit breakers prematurely.
* **SSE Stream Authentication**:
  * Allowed `token` and `api_token` query parameters in `index.ts` auth hook, ensuring browser `EventSource` streams connect without HTTP 401 when API tokens are enabled.
* **Active Profile Bricking**:
  * Verified profile existence before state updates and made `setActive(id)` atomic using `CASE WHEN id = ? THEN 1 ELSE 0 END`. Returns 404 on invalid IDs.
* **Mathematical & Scoring Edge Cases**:
  * Guarded against `NaN` and negative `priceEur` poisoning in DealScore calculator (returns score 0 and `WAIT`).
  * Removed ATL pre-clamping in `gameRepo.mapGameRow`, unlocking the Beat Bonus (+10 pts) and Score 100 on record drops.
  * Expanded Tukey IQR fences in `typicalSale.ts` to filter both lower glitches and extreme upper outliers.
  * Fixed inverted data insufficiency logic in `purchaseAdvice.ts`.
* **Frontend & Client Stability**:
  * Guarded against null ATL `.toFixed(2)` in `PeriodLowsBar.tsx` and null `productType` in `OffersTable.tsx`.
  * Prevented cross-game state bleed by resetting modal intelligence and AllKeyShop candidate states on `gameId` switch.
  * Fixed JSX literal `"0"` text rendering on 100% off/giveaway deals.

## [2.5.0] - 2026-09-18

### Added
* **Linear / Raycast Dark Aesthetic UI Redesign**:
  * Modern developer-centric dark design system with crisp 1px borders, subtle glass/translucent surface blur, and high-contrast semantic indicators.
  * JetBrains Mono typography for all numerical values (prices, percentage discounts, DealScore tickers, and currency values).
  * Ergonomic high-density compact rows and modern visual grid cards.
* **Hybrid Split-View / Slide-in Details Panel**:
  * Implemented an ergonomic slide-in right flyout details panel that displays comprehensive game intelligence while keeping the primary wishlist visible and fully keyboard-navigable (`j`/`k`/`↑`/`↓`/`Enter`/`Esc`).
  * Mobile-first responsive touch layout (<768px) gracefully adapting the flyout into a bottom sheet overlay.
* **Source Adapter Diagnostics & Self-Healing (Circuit Breakers)**:
  * **Automatic Note Dismissal**: Resolved the lingering "Last note" issue: `last_error` in SQLite and UI automatically clears to `NULL` as soon as subsequent requests succeed or the circuit breaker returns to `NORMAL`.
  * **Interactive Reset / Unpause**: Added `POST /api/sources/:code/reset` and an interactive "Reset / Unpause" action button in `SourcesModal`, allowing immediate unpausing of stalled adapters and resetting consecutive failure counters without waiting for multi-hour backoff.
  * **Toggle Auto-Reset**: Re-enabling any disabled source adapter automatically resets its circuit breaker state, consecutive failure counters, and backoff cooldowns.
* **AllKeyShop Scraper Resilience & Multi-Stage Fallback**:
  * When FlareSolverr / Byparr encounters timeouts or HTTP 500 errors on heavy live comparison pages, the adapter gracefully falls back to the lightweight JSON endpoint (`price_history_api.php`) instead of immediately aborting and incrementing source-wide consecutive failure penalties.
* **Non-Blocking AllKeyShop Override & Candidate Matching**:
  * `POST /api/games/:id/allkeyshop-override` immediately saves the chosen AllKeyShop slug/ID to the database and returns `200 OK`, dispatching the price refresh asynchronously in the background.
* **Inline Target Price Alert Card**:
  * Dedicated Target Price Alert card integrated directly into the game detail slide-in panel with 1-click modal configuration and immediate status badges.
* **Pricing Error Engine Calibration (`SOURCE_FAMILY_CONFLICT` & Known ATL Resilience)**:
  * Protected legitimate keyshop deals by verifying historical precedent: offers at or above a known confirmed low (`price >= atlEff - 0.05`) are immune from `SOURCE_FAMILY_CONFLICT` and `MARKET_OUTLIER` false alarms (e.g. *Divinity II: Developer's Cut* at 3.18 € vs 19.99 € MSRP, *Witchblood* at 1.55 € vs 9.99 € MSRP).
  - Raised intra-source conflict ratio threshold for `price > 1.005 €` from $5.0\times$ to $12.0\times$, accommodating authentic 80%–85% keyshop discount depths on older catalog games when official stores sit at full MSRP.
  * Preserved strict isolation for genuine sub-euro anomalies (`price <= 1.005 €` with ratio $\ge 3.0\times$, e.g. *Minecraft Legends* at 0.74 € vs 39.99 €).
  * Enhanced startup and post-sync `purgeCorruptedPricingErrors()` self-healing sweeps to auto-resolve false-positive source conflicts on valid deals and trigger `BEST_DEAL_RECOMPUTE_ALL_SQL` so unflagged offers immediately surface on the main overview.

## [2.4.0] - 2026-09-17

### Added
* **Steam Family Sharing Exclusions & Auto-Detection**:
  * Added database migration `027_add_family_sharing_exclusions` and repository methods (`excludeFamilySharingApp`, `includeFamilySharingApp`, `getFamilySharingExclusions`).
  * Wishlist listing, filtering (`hideFamilyShared`), and best deal queries automatically respect exclusions, ensuring games that Steam prohibits from family sharing (e.g. EA Play, Ubisoft Connect, Rockstar Launcher) remain visible and trackable.
  * Added `checkFamilySharingSupport` to `SteamSourceAdapter` leveraging official Steam Storefront Category 62 ("Family Sharing") and third-party DRM/account notices.
  * Added REST endpoints: `GET /api/family-sharing/exclusions`, `POST /api/family-sharing/exclude`, `POST /api/family-sharing/include`, `POST /api/family-sharing/auto-detect`.
  * Game Detail Modal displays real-time Family status banner with 1-click "Check Steam Support", "Demark (Not Shareable)", and "Restore" actions.
  * Profile Management Modal includes a dedicated Family Sharing Restrictions section with 1-click batch auto-detection.
* **Pricing Intelligence Modernization (ADR-1 through ADR-4) & Anomaly Refinement**:
  * **ADR-1 (SOURCE_FAMILY_CONFLICT Refinement)**: Confined internal conflict flags strictly to Keyshop tiers (official store offers are never marked as glitches). Refined threshold to require extreme intra-family price splits ($\ge 5.0\times$ or sub-euro $\ge 3.0\times$), while normal 2.0x–4.9x keyshop-to-official retail price spreads are treated as standard sales. Bypassed whenever other market peers corroborate the price.
  * **Approved 0.55 Lone Bottom Outlier Threshold (MARKET_OUTLIER)**: Strictly enforces `currentPrice < secondCheapest * 0.55` on the cheapest comparable offer with a meaningful price gap ($\ge 2.00\text{ €}$). Clustered normal sales (e.g. *Terminator Resistance* at €7.35–€8.85) produce zero false anomalies.
  * **Restricted FAKE_BASELINE Detection**: Restricted to offers claiming a discount below the game's official base MSRP (`price < steamBasePriceEur && claimedOriginalPriceEur > 1.5 * steamBasePriceEur`), preventing higher-tier deluxe editions or complete bundles from being falsely flagged.
  * **Calibrated DECIMAL_SHIFT & Sub-Euro Glitch Detection**: Distinguishes authorized official publisher sales on budget titles (e.g. *Hitman Contracts* at €0.89 on €8.99 MSRP) from genuine sub-euro pricing glitches on premium titles (€0.59 on €19.99 MSRP).
  * **Database Safety & Pricing Error Cleanup**: Added `purgeCorruptedPricingErrors()` to `src/server/db/cleanData.ts`, automatically dismissing 208 false positives and restoring 708 legitimate offers to Best Deals at startup.
  * **ADR-2 (OVER_MSRP)**: Informational signal alerting users when an offer exceeds the game's official baseline MSRP without penalizing the deal score.
  * **ADR-3 (Own-Type Median Discount Calibration)**: $S_{\text{disc}}$ discount depth scoring is calibrated against the game's own historical sale median rather than raw MSRP, preventing standard repeating discounts from over-scoring.
  * **ADR-4 (Market Liquidity / Depth Warning)**: Purchase advice warns when liquidity is shallow ($\le 9$ merchants) and current best price exceeds the historical sale median.
* **Scraper Guardrails & Phantom Price Elimination**:
  * Added validation in AllKeyShop (AKS) parser/scraper ensuring unreleased, unlisted, or missing games resolve to `null`, completely eliminating phantom `0.02 EUR` pricing. Discards prices $\le 0.05\text{ EUR}$ across all sources unless explicitly verified.
* **API Reliability & Resilience Hardening**:
  * CheapShark rate-limit resilience: strict single-request concurrency with exponential backoff on 429 and network failures.
  * ITAD batch error isolation: failing 150-item chunks no longer abort successfully fetched chunks; sync outcome accurately tracks partial vs full success.
  * AllKeyShop solver error propagation: HTTP 500/502/408/Cloudflare challenge errors propagate cleanly without silent fallback to direct IP scraping.

### Changed
* **Modernized UI Ergonomics & Consolidated Views**:
  * Consolidated wishlist view modes into 2 unified high-productivity layouts: **Compact List View** (streamlined single-line rows with full data fidelity) and **Grid View** (visual cards).
  * Removed legacy dense table in favor of the ergonomic compact view to streamline codebase maintenance.
  * Improved keyboard accessibility (`Tab`, `Enter`, `Escape`), focus outlines, and high-contrast deal badges.
* **Docker & CI/CD Security Hardening**:
  * Added standard OCI metadata labels (`org.opencontainers.image.*`) to `Dockerfile`.
  * Enforced explicit least-privilege permissions (`contents: read`) across all GitHub Actions workflow jobs.
  * Extended `.dockerignore` to keep build context clean and minimal.

---

## [2.3.0] - 2026-09-13


### Added
* **CheapShark True Multi-AppID Comma-Separated Batching**:
  * Bundles 25 Steam App IDs per comma-separated request (`/api/1.0/deals?steamAppID=id1,id2,...&pageSize=60`), reducing HTTP request volume by >90%.
  * Added pagination support (`pageSize=60`, up to 3 pages) when 60 deals are returned.
  * Added single-retry re-enqueue on 429 rate limit to leverage circuit breaker cooldown.
  * Extracted reusable `parseOfferFromDeal` helper and wrapped historical low lookup in isolated error boundary.
* **Epoch-Aware Rate Limit Header Parsing**:
  * Enhanced `parseRetryAfterHeader` in `base.ts` to parse Unix epoch timestamps (> 1,000,000,000) from Cloudflare `X-RateLimit-Reset` and `ratelimit-reset` headers alongside integer seconds and HTTP-dates.
* **Best Deal Freshness Hierarchy & Instant ATL Auto-Reconciliation**:
  * Implemented strict ranking hierarchy in `recomputeBestDealForGame` and `BEST_DEAL_RECOMPUTE_ALL_SQL`: Fresh safe offers ($\le 72\text{h}$) > Stale safe offers > Pricing errors excluded.
  * Instant automatic reconciliation of `historical_low_eur`, `historical_low_date`, and `historical_low_source` when a safe valid deal beats recorded ATL.
  * Startup database sweep auto-reconciling any catalog-wide historical low discrepancies.
* **Pricing Error Self-Healing & Dismissal**:
  * Added startup and post-sync sweeps to automatically dismiss historical pricing errors that are price increases, unflagged offers, or where a cheaper valid offer exists.
  * Added migration `026_cleanup_false_sub_euro_glitches` dismissing false sub-euro glitches on offers $\ge 1.005\text{ €}$ and recomputing best deals.

### Changed
* **Pacing & Queue Delay Defaults**:
  * Updated safe defaults across all adapters: Steam Store `1500ms → 2000ms`, ITAD `500ms → 1000ms`, CheapShark `500ms → 1500ms`, GG.deals `1000ms → 1500ms`.
  * Synchronized defaults across `config/index.ts`, `docker-compose.yml`, and documentation.
  * Increased queue jitter to safe margins (Steam: 250ms, ITAD: 200ms, CheapShark: 250ms, GG.deals: 300ms, AllKeyShop: 500ms).

---

## [2.2.0] - 2026-09-12

### Added
* **Deal Score v2.3 Mathematical Formula**:
  * Replaced linear discount scoring with a concave diminishing-returns curve: $30 \times ((\text{anchor} - \text{price})/\text{anchor})^{0.75}$, preventing premature saturation at 75% while rewarding 50%–80% sales.
  * Reserved Deal Score 100 exclusively for deals beating confirmed ATL by $\ge 5\%$.
  * Added provisional data sufficiency caps (40/65/80/85) for titles with sparse sample history (< 5 samples).
  * Added stale history cap (60) for observations older than 90 days.
* **Metacritic Critic Review Enrichment**:
  * Enriched `games.metacritic_score` and `games.metacritic_url` from CheapShark deal payloads.
* **Delisted Games Support**:
  * Added migration `025_add_games_is_delisted` to track removed titles.

---

## [2.1.0] - 2026-09-12

### Added
* **Source Adapter Diagnostics & Pacing Hardening**:
  * Added `scripts/test-sources.ts` live connectivity and parsing diagnostic suite (`npm run test:sources`).
  * Hardened auth token constant-time comparison in `src/server/routes/api.ts`.
  * Added detailed URL and preview snippet diagnostics to `safeFetchJson` on unexpected HTML/error responses.

---

## [2.0.0] - 2026-09-12

### Added
* **Pricing Error Architecture & Data Safety Engine**:
  * Replaced legacy anomaly tables with a dedicated `pricing_errors` system and backward-compatible `anomalies` view with `INSTEAD OF` triggers.
  * Added canonical error categorization (`DECIMAL_SHIFT`, `CATALOG_GLITCH`, `UNREASONABLE_CUT`) with fine-tuned detection thresholds ($\ge 90\%$ below MSRP for decimal shifts).
  * Rendered distinct error type badges in the Data Safety tab and added canonical error fields to CSV exports.
  * Active-only error counting (`is_valid = 1`) ensuring expired or resolved glitches do not keep the "Anomaly" filter chip lit.
* **Discord Glitch Hunter & Deal Alerts**:
  * Fast-track Glitch Hunter notifications targeting the specific flagged offer's price and merchant URL rather than the safe best deal.
  * Aligned Exceptional deal alerts and headline score cutoff to Deal Score $\ge 80$.
  * Added 72-hour stale observation guard preventing notifications on outdated pricing data.
* **Non-Blocking Price History Seeding**:
  * Converted ITAD history seeding on game detail and sync to non-blocking background promises with single-shot client follow-up refetching.
  * Ensured seeded ITAD merchants correctly record `is_official = 0` for keyshops (Kinguin, G2A, etc.) to prevent false ATL corroboration.
* **UI & Deal Score Threshold Alignment**:
  * Unified Exceptional deal tier across all views to Deal Score $\ge 80$.
  * Added `OVERPRICED` verdict in Price Intelligence when current price exceeds typical historical sale median.
  * Synced `RECORD_DROP` badge and ★ "Matches All-Time Low" callout across Grid, List, and Table views.

### Changed
* **Database Boot & Migration Resilience**:
  * Moved migration-dependent DDL out of `SCHEMA_SQL` into migration `024_post_migration_indexes_and_anomalies_view` for 100% crash-free upgrades on legacy databases.
  * Added automated table-to-view conversion and offer backfill safety nets.

---

## [1.7.1] - 2026-09-09

### Added
* **Steam Family Sharing Library Sync & Filter**:
  * Added `is_family` flag to Steam profiles and automatic ownership ingestion via `family_owned_apps` table.
  * Added `hideFamilyShared` wishlist filter option with SQL-level `NOT EXISTS` query and UI toggle badge to avoid buying games already accessible via family members.
* **Unreleased & Coming Soon Game Filter**:
  * Added `hideUnreleased` option to filter out games without price observations that have release dates indicating future/unreleased status (`coming soon`, `tba`).

### Fixed
* **Queue Cooldown & Cancellation Safeguards**:
  * Sliced cooldown sleep into 1s/2s intervals in `AllKeyShopPoliteQueue` and `PacedSourceQueue`, preventing multi-hour hangs when clearing or resetting queues.
  * Implemented fallback timeout for `BACKOFF` and `PAUSED` circuit breaker states when `cooldownUntil` is missing.
* **0 EUR Free Game & Corroboration Division Safety**:
  * Fixed `isValid` observation filtering in `offerRepo` to include valid 0 EUR free games and 100% discount promotions.
  * Guarded independent merchant corroboration calculation against division-by-zero when prices are 0 EUR.
* **V1 REST API `steam_app_id` Direct SQL Resolution**:
  * Added database-level `steamAppId` filtering to `buildWishlistFilterClause`, fixing in-memory pagination bugs on `GET /api/v1/games?steam_app_id=...`.
* **Robust Diagnostic JSON Parsing**:
  * Added detailed URL, status code, and preview snippet diagnostics to `safeFetchJson` on HTML/non-JSON responses.

---

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
