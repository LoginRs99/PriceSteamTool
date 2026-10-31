> **Historical snapshot.** Preserved from the repository during the Antigravity workflow redesign. This document reflects the state and claims at the time it was written; it is not a current specification or verification result.

# 🎮 PriceSteamTool — Master Project Summary & Architecture Reference

> **Comprehensive Technical Specification & System Overview**  
> **Version**: 2.8.2  
> **Status**: Production Ready | 84 Test Suites | 815 Tests Passing (100%)  
> **Runtime**: Node.js 22 LTS, Fastify 5, React 19, Vite, Better-SQLite3 (WAL Mode)

---

## 📌 1. Executive Summary

**PriceSteamTool** is an open-source, privacy-first, self-hosted Steam Wishlist Price Aggregator and Deal Intelligence engine designed to monitor 2,000+ games reliably without aggressive scraping, IP bans, or reliance on third-party cloud services.

Unlike generic price alert bots, PriceSteamTool separates **price magnitude** from **data risk**:
- It evaluates every deal using an objective mathematical scoring formula (**Deal Score 0–100**).
- It isolates glitches using a precision **Pricing Error Engine** with independent peer corroboration and self-healing auto-dismissal.
- It provides actionable **Purchase Advice** (`BUY`, `FAIR`, `WAIT`, `OVERPRICED`) based on Tukey's IQR statistical typical sale pricing.
- It tracks purchases and cumulative financial gains in a **Realized Savings Journal**.
- It safeguards data with **ATL Quarantine**, **Single-Source Protection**, and automated **Zero-Downtime SQLite Backups**.

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   Frontend (React 19 SPA)                              │
│  - Linear / Raycast Dark Aesthetic (JetBrains Mono numbers, crisp 1px borders, blur)   │
│  - Hybrid Split-View / Slide-in Details Panel (Keyboard j/k/Enter/Esc + touch sheet)   │
│  - Multi-Buyer Filters (Metacritic slider, Steam reviews %, IQR typical sale, Buy pills)│
│  - Live Multi-Currency Engine (EUR, USD, GBP, CAD, AUD, and native HUF Ft formatting)  │
│  - Realized Savings Tracker & Purchase Journal (Megtakarítás-követő)                   │
│  - Real-time Sync Progress Monitor (Server-Sent Events: /api/sync/events)               │
│  - Source Adapters Diagnostics & Self-Healing (1-click Reset & AKS Catalog Refresh)     │
│  - Steam Family Sharing Exclusions & 1-Click Storefront Category 62 Validation         │
│  - Grouped Data Safety Review (/api/anomalies) with 1-click DB Backup & Feedback       │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTP REST, ETag 304, & SSE
┌───────────────────────────────────────────▼────────────────────────────────────────────┐
│                              Backend Core (Node.js 22+ / Fastify 5)                     │
│  ┌─────────────────────────────────┐      ┌──────────────────────────────────────────┐ │
│  │       REST API Endpoints        │      │          Wishlist & Sync Manager         │ │
│  │   /api/profiles, /api/games     │      │  - Steam Wishlist Ingestion (IWishlist)  │ │
│  │   /api/sync, /api/purchases     │      │  - Priority Multi-Source Queues          │ │
│  │   /api/v1/* (Anti-Rate-Limit)   │      │  - Cache-First Refresh & TTL Manager     │ │
│  └────────────────┬────────────────┘      └────────────────────┬─────────────────────┘ │
│                   │                                            │                       │
│  ┌────────────────▼────────────────────────────────────────────▼─────────────────────┐ │
│  │                            Domain Intelligence Engines                            │ │
│  │  - Normalizer & Region Filter (EU/HU/Global verification, DRM key check)          │ │
│  │  - Offer Deduplicator & Multi-Source Observation Tracker (source_observations)    │ │
│  │  - Pricing Error Engine (8 Error Types, Corroboration Override, Self-Healing)     │ │
│  │  - Deal Score v2.3 Engine (4 Pillars, Diminishing-Returns Curve, Sigmoid Ramps)   │ │
│  │  - ATL Quarantine & Auto-Reconciliation (Single-source keyshop low protection)   │ │
│  │  - Price Intelligence Advisor (Period Lows, Tukey IQR Typical Sale, Volatility)   │ │
│  │  - Realized Savings Calculator (Snapshots vs MSRP & typical median)               │ │
│  │  - Automated Zero-Downtime Backup Engine (Online snapshot, quick_check, 7d prune) │ │
│  └────────────────────────────────────────┬──────────────────────────────────────────┘ │
│                                           │                                            │
│  ┌────────────────────────────────────────▼──────────────────────────────────────────┐ │
│  │                             Source Adapter Framework                              │ │
│  │  ┌───────────────┐ ┌───────────────┐ ┌─────────────────┐ ┌──────────────────────┐ │ │
│  │  │ Steam Store   │ │ ITAD Batch    │ │ CheapShark      │ │ GG.deals & Keyshops  │ │ │
│  │  │ (2000ms pace) │ │ (1000ms pace) │ │ Multi-AppID 25x │ │ (1500ms pace)        │ │ │
│  │  │ (MSRP/Review) │ │ (200 IDs/req) │ │ (1500ms pace)   │ │ AllKeyShop (2500ms)  │ │ │
│  │  └───────┬───────┘ └───────┬───────┘ └────────┬────────┘ └──────────┬───────────┘ │ │
│  │          │                 │                  │                     │             │ │
│  │          │ Paced Token-Bucket Queues with Exponential Jitter        │             │ │
│  │          │ 4-State Circuit Breakers (NORMAL → BACKOFF → PAUSED → COOLDOWN)        │ │
│  │          │ Epoch-Aware Header Parser (parseRetryAfterHeader: seconds/epoch)       │ │
│  └──────────┴─────────────────┴──────────────────┴─────────────────────┴─────────────┘ │
│                                           │                                            │
│  ┌────────────────────────────────────────▼──────────────────────────────────────────┐ │
│  │                         Persistent Store (SQLite 3 in WAL Mode)                   │ │
│  │  /data/pricetool.db (WAL Journal, Busy Timeout 5000ms, Foreign Keys, Stmt Cache)   │ │
│  │  16 Tables, Migrations 001–031, Automated Backups (/data/backups/)                 │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧠 2. Core Domain Intelligence Engines

### 2.1 Deal Score Engine v2.3 (`src/server/domain/dealScore/`)
Trust-free, monotonic mathematical scoring formula mapping deals onto a 0–100 scale:
$$\text{RawScore} = S_{\text{atl}} (0\text{--}40) + S_{\text{disc}} (0\text{--}30) + S_{\text{hist}} (0\text{--}20) + S_{\text{mkt}} (0\text{--}10)$$

1. **$S_{\text{atl}}$ (Proximity to All-Time Low, 0–40 pts):**
   * Matching confirmed ATL awards **36 points base**.
   * Undercutting confirmed ATL awards up to **+4 points bonus** (maxing at 20% undercut).
   * Unconfirmed or single-source keyshop ATL is penalized by 50%.
   * Scales proportionally with discount depth relative to MSRP anchor (never-discounted games with ATL $\approx$ MSRP receive near-zero $S_{\text{atl}}$ score).
2. **$S_{\text{disc}}$ (Discount Depth, 0–30 pts):**
   * Diminishing-returns power curve:
     $$S_{\text{disc}} = 30 \times \left(\frac{\text{anchor} - \text{price}}{\text{anchor}}\right)^{0.75}$$
   * Differentiates deep cuts without premature saturation while rewarding legitimate 50%–80% sales. Requires $\ge 10\%$ discount. Fake baseline markup protection ($>1.5\times$ base price) drops score to 0.
3. **$S_{\text{hist}}$ (Historical Sale Distribution, 0–20 pts):**
   * Evaluates price position relative to typical historical sale median derived via Tukey's IQR Fences.
4. **$S_{\text{mkt}}$ (Cross-Market Position, 0–10 pts):**
   * Measures competitiveness across all fresh peer offers in the market. Official store single offers receive a default score of 7.

* **Safety Caps & Continuous Confidence:**
  * **Provisional History Cap:** If $<5$ samples: $\ge 60\%$ discount capped at 80 (85 for official store); some history capped at 65; no history capped at 40.
  * **Stale History Cap:** Price observations $>90$ days old are capped at 60.
  * **Score 100 Reservation:** Score is capped at 99 unless the price beats the confirmed ATL by $\ge 5\%$.
  * **Continuous Sigmoid Ramp:** Sample count and recency ramp smoothly using logistic curves instead of step thresholds.
  * **Weighted Geometric Mean:** Confidence factors combine geometrically with floor protection, preventing a single weak factor from zeroing overall confidence.

* **Score Tiers & Purchase Verdicts:**
  * `Exceptional` ($\ge 80$) $\rightarrow$ `INSTANT_BUY`
  * `Great` ($\ge 60$) $\rightarrow$ `GREAT_DEAL`
  * `Fair` ($\ge 40$) $\rightarrow$ `FAIR_DEAL`
  * `Weak` ($< 40$) $\rightarrow$ `WAIT`
  * Price $> \text{MSRP}$ $\rightarrow$ `OVERPRICED`
  * Flagged pricing error $\rightarrow$ Score `0`, Tier `Weak`, Verdict `WAIT`.

### 2.2 Pricing Error Engine & Self-Healing (`src/server/domain/pricingError/`)
Precision pricing-error detector focused on high-confidence glitches and extreme outliers:
* **The 8 Error Types**:
  1. `DECIMAL_SHIFT`: Sub-euro glitches ($\le 1.005\text{ €}$) on titles with MSRP $\ge 10\text{ €}$, missing digit shifts ($\sim 1/10$ or $\sim 1/100$ of MSRP on MSRP $\ge 30\text{ €}$), or extreme drops ($\le 3\%$ on MSRP $\ge 15\text{ €}$).
  2. `MARKET_OUTLIER`: Lone store $>50\%$ below single peer or $>75\%$ below multi-peer median (threshold 0.55 on cheapest comparable offer with $\ge 2.00\text{ €}$ gap).
  3. `SOURCE_FAMILY_CONFLICT`: Strictly assigned to Keyshop tiers. Flags extreme intra-source conflicts ($\ge 12.0\times$, or sub-euro $\ge 3.0\times$) between keyshop and official listings from the same aggregator. Bypassed when peer corroboration exists or offer matches confirmed low.
  4. `FAKE_BASELINE`: Restricted to offers claiming discounts below Steam base price where claimed original price $> 1.5\times$ base MSRP.
  5. `BELOW_ATL_IMPLAUSIBLE`: Price $>50\%$ below established confirmed ATL.
  6. `OWN_HISTORY_BREAK`: Sudden price collapse vs merchant's own historical median ($z > 2.5$).
  7. `FRESH_RELEASE_DROP`: $>40\%$ drop on games released $<30$ days ago without publisher confirmation.
  8. `EDITION_INVERSION`: Deluxe/Gold edition priced $>30\%$ below the base game.
* **Peer Corroboration Override**:
  * $\ge 2$ independent fresh peer prices within $\pm 40\%$ override pricing errors (`SUB_EURO_PREMIUM_GLITCH_CORROBORATED`), preventing false alarms on authentic coordinated sales.
* **Self-Healing & Auto-Dismissal**:
  * Startup checks and post-sync sweeps automatically dismiss pricing errors when the price has increased, when the offer was unflagged, or when another valid offer is cheaper.
  * Glitched offers have `is_likely_pricing_error = 1`, excluding them from best deal selection.

### 2.3 ATL Quarantine & Auto-Reconciliation
* **Quarantine**: Single-source unconfirmed new ATL offers from non-official sources are quarantined from immediately overwriting `games.historical_low_eur` and corrupting typical sale medians until corroborated or confirmed by official stores.
* **Auto-Reconciliation**: When `recomputeBestDealForGame` identifies a safe valid offer cheaper than `game.historical_low_eur`, it immediately reconciles `historical_low_eur`, `historical_low_date`, and `historical_low_source`.
* **Freshness Hierarchy**:
  $$\text{Fresh Safe Offers } (\le 72\text{h}) > \text{Stale Safe Offers} > \text{Pricing Errors Excluded}$$

### 2.4 Price Intelligence Advisor (`src/server/domain/priceIntelligence/`)
* **Rolling Period Lows**: Non-synthetic 7-day, 30-day, 90-day, 1-year, and confirmed All-Time Lows (returns `null` when tracking history is shorter than the period).
* **Typical Sale Price**: Computed using Tukey's Interquartile Range (IQR) Fences across discount observations ($\ge 15\%$ off) to establish true median, $Q1$, and $Q3$.
* **Price Volatility (CV)**: Daily Best Trusted Price relative standard deviation on observed calendar days (`Stable`, `Moderate`, `Volatile`).
* **Sale Drop Frequency**: Annual discount rhythm (`Frequent`, `Regular`, `Rare`).

### 2.5 Realized Savings & Purchase Journal (`src/server/db/repositories/purchase.ts`)
* Log bought games directly from Offers table ("Megvettem" button) or dedicated Journal view.
* Snapshots purchase price, historical MSRP, and typical sale median at the exact moment of purchase.
* Realized savings dashboard: total spent, savings vs MSRP, savings vs typical sale median, and monthly purchase trends.

---

## 📡 3. Source Adapters & Pacing Architecture

| Source Adapter | Protocol & Format | Batching Capacity | Pacing Delay | Jitter | Role & Special Features |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Steam Storefront** | Undocumented Web API | 200 items / page | 2000 ms | 250 ms | Canonical wishlist ingestion, MSRP anchor, Category 62 Family Sharing validation |
| **IsThereAnyDeal** | Official REST v2 / v3 | 200 items / req | 1000 ms | 200 ms | 40+ official verified storefronts, chunk-isolated failure resilience |
| **CheapShark** | Public REST API | 25 AppIDs / comma req | 1500 ms | 250 ms | Multi-AppID batching, pagination (up to 3 pages), Metacritic enrichment |
| **GG.deals** | Developer JSON API | Per-game & Batch | 1500 ms | 300 ms | Hybrid official + marketplace deal aggregator, `SOURCE_FAMILY_CONFLICT` detection |
| **AllKeyShop** | Internal JSON API | Per-title queue | 2500 ms | 500 ms | Solver-mediated (Byparr / FlareSolverr) with proxy forwarding (`ALLKEYSHOP_PROXY_URL`), configurable chunk pacing (`ALLKEYSHOP_CHUNK_SIZE`, `ALLKEYSHOP_CHUNK_PAUSE_MS`), adaptive check backoff (24h–168h), and optional unlimited full scrape (`ALLKEYSHOP_MAX_GAMES=0`) |

* **Circuit Breakers**: 4-State finite state machine (`NORMAL` → `BACKOFF` → `PAUSED` → `COOLDOWN` → `NORMAL`).
* **Epoch-Aware Header Parser**: Automatically parses integer seconds, HTTP-dates, and Unix epoch timestamps from Cloudflare rate-limit headers.

---

## 🗄️ 4. Database Architecture & Schema Specification

* **Engine**: SQLite 3 via `better-sqlite3` in WAL mode (`PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`, `PRAGMA foreign_keys = ON`, `PRAGMA cache_size = -64000`).
* **Zero-Downtime Backup Engine**: Online non-blocking SQLite backup using `db.backup()` with `PRAGMA wal_checkpoint(PASSIVE)` and post-backup `PRAGMA quick_check` verification. Rolling 7-day retention in `/data/backups/`.
* **The 16 Database Tables**:
  1. `profiles`: Steam accounts and family sharing markers.
  2. `games`: Metadata, MSRP, historical low, deal score stats, review scores, SteamDB rating, Metacritic score & URL, delisted flag.
  3. `wishlist_entries`: Profile-to-game mappings, priorities, target prices.
  4. `merchants`: Official vs keyshop stores (no synthetic trust score).
  5. `offers`: Canonical deduplicated offers, normalized EUR prices, raw prices/currencies, pricing error flags.
  6. `source_observations`: Raw provenance records per adapter for each offer, with stored `fx_rate` and `fx_rate_timestamp`.
  7. `price_history`: Immutable price change snapshots with `is_pricing_error` flag and deal score.
  8. `sources`: Source adapter states, counters, error notes, and cooldown timestamps.
  9. `sync_runs`: Granular execution tracking per sync cycle.
  10. `pricing_errors`: Isolated error detection records with dismissal state, user feedback, and feedback timestamps.
  11. `settings`: Key-value application settings.
  12. `notifications_log`: Discord webhook rate-limiting and alert deduplication.
  13. `family_owned_apps`: Steam Family Sharing library tracking.
  14. `steam_assets`: Cached high-resolution artwork keyed by `(steam_app_id, asset_type)`.
  15. `family_sharing_exclusions`: Games excluded from Steam Family Sharing with reason tags.
  16. `purchases`: Purchase journal tracking bought games with historical MSRP and typical sale median snapshots.

---

## 🌐 5. REST & Real-Time API Surface

### 5.1 Single-Page Application (SPA) REST Routes (`src/server/routes/api.ts`)
* **Health & Diagnostics**: `GET /api/health`, `GET /api/diagnostics/summary`, `GET /api/diagnostics/logs`.
* **Backups**: `POST /api/backup` (manual snapshot), `GET /api/backups` (list archives).
* **Profiles**: `GET/POST /api/profiles`, `PUT /api/profiles/:id/active`, `PUT /api/profiles/:id/family`, `DELETE /api/profiles/:id`.
* **Family Sharing**: `GET /api/family-sharing/exclusions`, `POST /api/family-sharing/exclude`, `POST /api/family-sharing/include`, `POST /api/family-sharing/auto-detect`.
* **Catalog & Deals**: `GET /api/games`, `GET /api/games/:id`, `GET /api/games/:id/intelligence`, `POST /api/games/:id/refresh`, `GET /api/wishlist/statistics`, `GET /api/wishlist/best-deals`.
* **Target Prices**: `POST /api/wishlist/:gameId/target-price`.
* **Sync Management**: `POST /api/sync/start`, `POST /api/sync/cancel`, `GET /api/sync/status`, `GET /api/sync/overview`.
* **Server-Sent Events (SSE)**: `GET /api/sync/events` (real-time per-game synchronization telemetry).
* **Currency**: `GET /api/exchange-rates` (live multipliers from EUR).
* **Sources**: `GET /api/sources`, `POST /api/sources/:code/toggle`, `POST /api/sources/:code/reset`.
* **Pricing Errors & Anomalies**: `GET /api/pricing-errors`, `POST /api/pricing-errors/:id/dismiss`, `POST /api/pricing-errors/dismiss-all`, `GET /api/anomalies`, `POST /api/anomalies/:id/feedback`, `GET /api/anomalies/stats`.
* **Purchases & Savings**: `GET/POST/DELETE /api/purchases`, `GET /api/purchases/savings`.
* **Data Export**: `GET /api/export/offers.csv` (14-column spreadsheet export).
* **Discord Integration**: `GET/POST /api/settings/discord`, `POST /api/settings/discord/test`.
* **AllKeyShop Matching**: `GET /api/games/:id/allkeyshop-candidates`, `POST /api/games/:id/allkeyshop-override`.

### 5.2 Anti-Rate-Limit v1 API (`src/server/routes/v1.ts`)
* `POST /api/v1/offers/batch`: Batch pricing endpoint resolving up to 250 games in a single request.
* `POST /api/v1/games/resolve`: Bulk game lookup resolving Steam AppIDs and title queries.
* `GET /api/v1/games`: Catalog endpoint with pagination envelope and ETag `304 Not Modified` caching.
* `GET /api/v1/games/:id`: Supports internal UUID and `steam:<appId>` paths.
* `GET /api/v1/merchants`, `GET /api/v1/merchants/:id`, `GET/POST/DELETE /api/v1/alerts`, `GET /api/v1/quota`.
* Standard IETF rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-API-Version`).

---

## 💻 6. Frontend SPA & Design System

* **Design Aesthetic**: Linear / Raycast developer dark theme with crisp 1px borders, subtle glass/translucent surface blur, high-contrast semantic indicators, and JetBrains Mono numerical typography.
* **Navigation & View Modes**:
  * **Compact List View**: High-density single-line rows with full data fidelity, keyboard navigable (`j`/`k`/`↑`/`↓`/`Enter`/`Esc`).
  * **Grid View**: Visual cards with artwork, DealScore badges, and store icons.
  * **Top Best Deals**: Dashboard carousel/grid filtered by Deal Score tiers.
  * **Free to Play / 100% Off**: Dedicated tab for zero-price games and publisher giveaways.
  * **Data Safety / Pricing Errors**: Grouped anomaly review with 1-click user verification and CSV export.
  * **Purchase Journal / Realized Savings**: Financial savings tracker and purchase history.
* **Hybrid Slide-in Flyout Panel / Mobile Bottom Sheet**:
  * Displays Decision Hero, Period Lows Bar, Intel Metrics Grid, Interactive SVG Price Chart, Full Offers Table with "Megvettem" logging, Smart Target Price Presets, and AllKeyShop Match Selector.
* **Live Multi-Currency (`CurrencyContext`)**:
  * Seamless on-the-fly display conversion for EUR, USD, GBP, CAD, AUD, and native Hungarian Forint (`HUF`) with integer formatting (`3 990 Ft`).

---

## 🧪 7. Automated Testing & Verification Suite

* **Total Test Suites**: 84 test files.
* **Total Automated Tests**: 815 tests.
* **Pass Rate**: **100% (0 failures)**.
* **Execution Time**: ~97 seconds (sequential single-process execution via Vitest).
* **Test Architecture**:
  * `tests/unit/`: Domain scoring, pricing error heuristics, normalizers, adapter logic, backup engine.
  * `tests/integration/`: End-to-end REST API validation, CSV exports, family sharing, database migrations.
  * `tests/client/`: React 19 UI component rendering, modal interactions, custom hooks, and keyboard ergonomics.

---

## 🚀 8. Operational & Development Quick Reference

### 8.1 Key CLI Commands
```bash
# Typecheck TypeScript codebase
npm.cmd run typecheck       # tsc --noEmit

# Run complete test suite (84 files, 815 tests)
npm.cmd test                # vitest run --fileParallelism=false

# Run server or client tests separately
npm.cmd run test:server     # vitest run --project server
npm.cmd run test:client     # vitest run --project client

# Live network source diagnostics
npm.cmd run test:sources    # tsx scripts/test-sources.ts

# Production build and run
npm.cmd run build           # Compiles Vite client and tsc server
npm.cmd start               # node dist/server/index.js
```

### 8.2 Docker Deployment
```bash
# Build and start containerized stack
docker compose up -d --build

# View real-time container logs
docker compose logs -f pricetool

# Trigger manual online database backup
curl -X POST http://localhost:3000/api/backup
```

---

*PriceSteamTool is maintained by the open-source community under the MIT License.*
