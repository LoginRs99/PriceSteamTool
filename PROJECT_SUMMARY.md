# 🎮 PriceSteamTool — Project Summary & Architecture Guide

> **Quick Reference for AI Assistants, Future Sessions & Developers**  
> Complete technical documentation is maintained in [`docs/`](file:///D:/github/Pricetool/docs/), with deep dives in [`docs/architecture.md`](file:///D:/github/Pricetool/docs/architecture.md), [`docs/data-model.md`](file:///D:/github/Pricetool/docs/data-model.md), [`docs/sources.md`](file:///D:/github/Pricetool/docs/sources.md), [`docs/sync.md`](file:///D:/github/Pricetool/docs/sync.md), [`docs/project-logs.md`](file:///D:/github/Pricetool/docs/project-logs.md), and [`docs/user-guide.md`](file:///D:/github/Pricetool/docs/user-guide.md).

---

## 📌 TL;DR Overview (v2.7.1)

PriceSteamTool is an open-source, privacy-first, self-hosted Steam Wishlist Price Aggregator and Deal Intelligence platform designed to monitor 2,000+ games reliably without aggressive scraping or IP bans:

- **Backend Runtime:** Node.js 22+ LTS, Fastify 5, TypeScript 5+, Better-SQLite3 (WAL journal mode, prepared statement caching, composite indexing, foreign key constraints, zero-downtime online backup API).
- **Frontend SPA:** React 19, TypeScript, Vite, Linear / Raycast dark design system with JetBrains Mono numbers, Hybrid Split-View / Slide-in Details Panel (keyboard `j`/`k`/`↑`/`↓`/`Enter`/`Esc` + mobile touch bottom sheet), Live Multi-Currency display (EUR, USD, GBP, CAD, AUD, HUF), Realized Savings Journal ("Megtakarítások"), Smart Target Price Presets (Typical, Q1 Great, Record Low), Source Adapters Diagnostics with 1-click Reset/Unpause, Steam Family Sharing Exclusions with 1-click Storefront Category 62 checking, Data Safety error review with User Feedback loop, and 14-column CSV export.
- **REST & Real-Time APIs:**
  - Standard SPA routes: `/api/profiles`, `/api/games`, `/api/sources`, `/api/sources/:code/reset`, `/api/sync`, `/api/pricing-errors`, `/api/anomalies/feedback`, `/api/purchases`, `/api/purchases/savings`, `/api/backup`, `/api/family-sharing/exclusions`, `/api/export/offers.csv`.
  - Server-Sent Events (SSE): `/api/sync/events` for live per-game synchronization telemetry.
  - Anti-Rate-Limit v1 API: `/api/v1/offers/batch` (bulk pricing up to 250 games), `/api/v1/games/resolve` (bulk AppID/title match), `GET /api/v1/games` with ETag `304 Not Modified` caching and standard IETF rate-limit headers.
- **Data Sources & Paced Adapters:**
  - **Steam Storefront:** Canonical wishlist ingestion + base price/review baseline + official Category 62 Family Sharing validation (Pacing: 2000ms, jitter 250ms).
  - **IsThereAnyDeal (ITAD v2/v3):** High-batch official store aggregator for 40+ stores with chunk-isolated failure resilience (Pacing: 1000ms, jitter 200ms).
  - **CheapShark:** True multi-AppID comma-separated batching (25 App IDs per request, `pageSize=60`, up to 3 pages pagination, Metacritic review/score enrichment, 429 single re-enqueue backoff, Pacing: 1500ms, jitter 250ms).
  - **GG.deals:** Hybrid official + marketplace deal aggregator with `SOURCE_FAMILY_CONFLICT` detection ($\ge 12.0\times$ or sub-euro $\ge 3.0\times$) and `OVER_MSRP` detection (Pacing: 1500ms, jitter 300ms).
  - **AllKeyShop:** Unofficial internal JSON endpoints via anti-bot solver (Byparr / FlareSolverr) with adaptive check backoff (24h to 168h), fair round-robin scheduling, exponential jitter, dual-layer page & API fallback, phantom 0.02 EUR guardrails, and solver error propagation (Pacing: 2500ms, jitter 500ms).
- **Canonical Type System:** Single Source of Truth in [`src/shared/types.ts`](file:///D:/github/Pricetool/src/shared/types.ts), defining unified models (`Game`, `Offer`, `PricingErrorEvaluation`, `PricingErrorType`, `PriceEventType`, `DealScoreBreakdown`, `DealVerdict`, `WishlistEntry`, `PurchaseEntry`).

---

## 🧠 Core Intelligence & Decision Engines

### 1. Deal Score v2.3 (`src/server/domain/dealScore/`)
Trust-free, monotonic mathematical scoring formula mapping deals onto a 0–100 scale:
$$\text{RawScore} = S_{\text{atl}} (0\text{--}40) + S_{\text{disc}} (0\text{--}30) + S_{\text{hist}} (0\text{--}20) + S_{\text{mkt}} (0\text{--}10)$$

1. **$S_{\text{atl}}$ (Proximity to All-Time Low, 0–40 pts):** Matches confirmed ATL awards 36 points base. Undercutting confirmed ATL awards up to +4 points bonus (maxing at 20% undercut). Unconfirmed or single-source keyshop ATL is penalized by 50%. Scales with discount depth relative to MSRP anchor.
2. **$S_{\text{disc}}$ (Discount Depth, 0–30 pts):** Diminishing-returns power curve:
   $$S_{\text{disc}} = 30 \times \left(\frac{\text{anchor} - \text{price}}{\text{anchor}}\right)^{0.75}$$
   Differentiates deep cuts without premature saturation while rewarding legitimate 50%–80% sales. Requires $\ge 10\%$ discount to award points. Fake baseline markup protection ($>1.5\times$ base price) drops score to 0.
3. **$S_{\text{hist}}$ (Historical Sale Distribution, 0–20 pts):** Evaluates price position relative to typical historical sale median (derived via Tukey's IQR Fences).
4. **$S_{\text{mkt}}$ (Cross-Market Position, 0–10 pts):** Measures competitiveness across all fresh peer offers in the market. Official store single offers receive a default score of 7.
- **Safety Caps & Continuous Confidence:**
  - **Provisional History Cap:** If $<5$ samples: $\ge 60\%$ discount capped at 80 (85 for official store); some history capped at 65; no history capped at 40.
  - **Stale History Cap:** Price observations $>90$ days old are capped at 60.
  - **Score 100 Reservation:** Score is capped at 99 unless the price beats the confirmed ATL by $\ge 5\%$.
  - **Continuous Sigmoid Ramps:** Sample count and recency ramp smoothly using logistic curves instead of step thresholds.
  - **Weighted Geometric Mean:** Confidence factors combine geometrically with floor protection.
- **Score Tiers & Purchase Verdicts:**
  - `Exceptional` ($\ge 80$) $\rightarrow$ `INSTANT_BUY`
  - `Great` ($\ge 60$) $\rightarrow$ `GREAT_DEAL`
  - `Fair` ($\ge 40$) $\rightarrow$ `FAIR_DEAL`
  - `Weak` ($< 40$) $\rightarrow$ `WAIT`
  - Price $> \text{MSRP}$ $\rightarrow$ `OVERPRICED`
  - Flagged pricing error $\rightarrow$ Score `0`, Tier `Weak`, Verdict `WAIT`.

### 2. Pricing Error Engine & Self-Healing (`src/server/domain/pricingError/`)
Precision pricing-error detector focused on high-confidence glitches and extreme outliers:
- **Error Types & Calibration:**
  - `MARKET_OUTLIER`: Enforces threshold 0.55 (`currentPrice < secondCheapest * 0.55`) on the cheapest comparable offer with a meaningful gap ($\ge 2.00\text{ €}$). Clustered market sales produce zero false positives.
  - `SOURCE_FAMILY_CONFLICT`: Strictly assigned to Keyshop tiers (never official retail offers). Flags extreme price conflicts ($\ge 12.0\times$ or sub-euro $\ge 3.0\times$) between keyshop and official listings from the same source. Bypassed when peer corroboration exists or offer matches confirmed low.
  - `DECIMAL_SHIFT`: Distinguishes authorized publisher budget sales (€0.89 on €8.99 MSRP) from genuine sub-euro glitches on premium titles (€0.59 on €19.99 MSRP), missing digit shifts ($\sim 1/10$ or $\sim 1/100$ on MSRP $\ge 30\text{ €}$), or extreme drops ($\le 3\%$ on MSRP $\ge 15\text{ €}$).
  - `FAKE_BASELINE`: Restricted to offers claiming discounts below Steam base price (`price < steamBasePriceEur && claimedOriginalPriceEur > 1.5 * steamBasePriceEur`).
  - `BELOW_ATL_IMPLAUSIBLE`: Price $>50\%$ below established confirmed ATL.
  - `OWN_HISTORY_BREAK`: Sudden price collapse vs merchant's own historical median ($z > 2.5$).
  - `FRESH_RELEASE_DROP`: $>40\%$ drop on games released $<30$ days ago without publisher confirmation.
  - `EDITION_INVERSION`: Deluxe/Gold edition priced $>30\%$ below the base game.
- **Independent Peer Corroboration:** $\ge 2$ independent fresh peer prices within $\pm 40\%$ override pricing errors (`SUB_EURO_PREMIUM_GLITCH_CORROBORATED`).
- **Self-Healing & User Feedback:**
  - Startup checks and post-sync sweeps automatically dismiss pricing errors when the price has increased, when the offer was unflagged, or when another valid offer is cheaper.
  - Users can submit feedback ("Valódi hiba" vs "Téves riasztás") in `AnomaliesView`. False positives instantly unflag the offer and trigger immediate Best Deal recomputation.

### 3. Best Deal Selection, ATL Quarantine & Auto-Reconciliation
- **Ranking Hierarchy:** Fresh safe offers ($\le 72\text{h}$) strictly take precedence over stale safe offers, which take precedence over cheaper glitched offers:
  $$\text{Freshness Tier } (0 \text{ if } \le 72\text{h else } 1) \rightarrow \text{price\_eur ASC} \rightarrow \text{last\_observed\_at DESC}$$
- **ATL Quarantine:** Single-source unconfirmed new ATL offers from keyshops are quarantined from immediately overwriting `games.historical_low_eur` until corroborated or confirmed by official stores.
- **Auto-Reconciliation:**
  - When `recomputeBestDealForGame` identifies a safe valid offer cheaper than `game.historical_low_eur`, it immediately reconciles `historical_low_eur`, `historical_low_date`, and `historical_low_source`.
  - Batch SQL sweeps (`BEST_DEAL_RECOMPUTE_ALL_SQL`) heal any historical low discrepancies across the entire database.

### 4. Price Intelligence & Decision Advisor (`src/server/domain/priceIntelligence/`)
- **Period Lows:** Non-synthetic 7-day, 30-day, 90-day, 1-year, and confirmed All-Time Lows (returns `null` when tracking history is shorter than the period).
- **Typical Sale Price:** Computed using Tukey's Interquartile Range (IQR) Fences across discount observations ($\ge 15\%$ off) to establish true median, $Q1$, and $Q3$.
- **Price Volatility (CV):** Relative standard deviation on observed calendar days (`Stable`, `Moderate`, `Volatile`).
- **Sale Drop Frequency:** Annual discount rhythm (`Frequent`, `Regular`, `Rare`).

### 5. Purchase Journal & Realized Savings Tracker (`src/server/db/repositories/purchase.ts`)
- Log bought games directly from Offers table ("Megvettem" button) or dedicated Journal view.
- Snapshots purchase price, historical MSRP, and typical sale median at the moment of purchase.
- Realized savings analytics dashboard: total spent, savings vs MSRP, savings vs typical sale median, and monthly trends.

---

## 🗄️ Database & Migration Architecture

- **Engine:** SQLite 3 via `better-sqlite3` in WAL mode (`PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`, `PRAGMA foreign_keys = ON`, `PRAGMA cache_size = -64000`).
- **Disaster Recovery:** Online non-blocking SQLite backup engine (`better-sqlite3` `db.backup()`) with `PRAGMA wal_checkpoint(PASSIVE)`, automatic `PRAGMA quick_check` integrity verification, and rolling 7-day retention in `/data/backups/`.
- **Migrations (001–031):** Managed sequentially via `src/server/db/migrations.ts`:
  - `027_add_family_sharing_exclusions`: Added `family_sharing_exclusions` table and Steam Category 62 checking.
  - `028_composite_indexes_and_fx_audit`: Added composite indexes (`idx_wishlist_profile_active_priority`, `idx_offers_game_valid_error_price`), stored `fx_rate` and `fx_rate_timestamp`, created `sync_runs` table.
  - `029_anomaly_feedback_loop`: Added user feedback columns to `pricing_errors` and index.
  - `030_purchases_and_savings_tracker`: Created `purchases` table and index topology.
  - `031_perf_indexes_and_best_deal_optimization`: Created composite indexes for sync runs, pricing error resolution, price history, and best deals.
- **The 16 Schema Tables:**
  `profiles`, `games`, `wishlist_entries`, `merchants`, `offers`, `source_observations`, `price_history`, `sources`, `sync_runs`, `pricing_errors`, `settings`, `notifications_log`, `family_owned_apps`, `steam_assets`, `family_sharing_exclusions`, `purchases`.

---

## 🚀 Key Commands & Verification

```bash
# 1. Typecheck (TypeScript compiler check)
npm run typecheck      # tsc --noEmit

# 2. Automated Test Suite
npm test               # vitest run --fileParallelism=false (82 test files, 776 tests passing 100%)
npm run test:server    # vitest run --project server
npm run test:client    # vitest run --project client
npm run test:sources   # Live network adapter diagnostic test

# 3. Development Mode
npm run dev            # Concurrently runs Fastify backend (tsx watch) & Vite client

# 4. Production Build & Run
npm run build          # Compiles client (Vite) and server (tsc)
npm start              # Runs production server (node dist/server/index.js)
```

---

## 📂 Codebase Navigation for AI Agents

| Path | Purpose |
| :--- | :--- |
| [`src/shared/types.ts`](file:///D:/github/Pricetool/src/shared/types.ts) | Canonical TypeScript interfaces and domain enums |
| [`src/server/domain/dealScore/`](file:///D:/github/Pricetool/src/server/domain/dealScore/) | Deal Score v2.3 calculator, sigmoid confidence, tiers, and legacy helpers |
| [`src/server/domain/pricingError/`](file:///D:/github/Pricetool/src/server/domain/pricingError/) | Pricing error detector, price event classifier, and self-healing logic |
| [`src/server/domain/priceIntelligence/`](file:///D:/github/Pricetool/src/server/domain/priceIntelligence/) | Purchase advice advisor, IQR typical sale, period lows, volatility |
| [`src/server/sources/`](file:///D:/github/Pricetool/src/server/sources/) | Multi-source adapters (`steam.ts`, `itad.ts`, `cheapshark.ts`, `ggdeals.ts`, `allkeyshop.ts`, `base.ts`) |
| [`src/server/sync/`](file:///D:/github/Pricetool/src/server/sync/) | Rate limiters (`rateLimiter.ts`), circuit breakers (`circuitBreaker.ts`), sync orchestrator (`orchestrator.ts`) |
| [`src/server/db/`](file:///D:/github/Pricetool/src/server/db/) | Schema (`schema.ts`), migrations (`migrations.ts`), repositories (`repositories/`), backup (`backup.ts`), core (`core.ts`) |
| [`src/server/routes/`](file:///D:/github/Pricetool/src/server/routes/) | REST API handlers (`api.ts`), anti-rate-limit API (`v1.ts`), SSE stream |
| [`src/client/src/`](file:///D:/github/Pricetool/src/client/src/) | React 19 SPA components, hooks, modals, currency context, and styles |
| [`docs/`](file:///D:/github/Pricetool/docs/) | Comprehensive Markdown architectural guides, sitemap, logs, and API references |
