# 🎮 PriceSteamTool — Project Summary & Architecture Guide

> **Quick Reference for AI Assistants, Future Sessions & Developers**  
> Complete technical documentation is maintained in [`docs/`](file:///D:/github/Pricetool/docs/), with deep dives in [`docs/architecture.md`](file:///D:/github/Pricetool/docs/architecture.md), [`docs/data-model.md`](file:///D:/github/Pricetool/docs/data-model.md), [`docs/sources.md`](file:///D:/github/Pricetool/docs/sources.md), [`docs/sync.md`](file:///D:/github/Pricetool/docs/sync.md), and [`docs/user-guide.md`](file:///D:/github/Pricetool/docs/user-guide.md).

---

## 📌 TL;DR Overview (v2.5.0)

PriceSteamTool is an open-source, privacy-first, self-hosted Steam Wishlist Price Aggregator and Deal Intelligence platform designed to monitor 2,000+ games reliably without aggressive scraping or IP bans:

- **Backend Runtime:** Node.js 22+ LTS, Fastify 5, TypeScript 5+, Better-SQLite3 (WAL journal mode, prepared statement caching, composite indexing, foreign key constraints).
- **Frontend SPA:** React 19, TypeScript, Vite, Linear / Raycast dark design system with JetBrains Mono numbers, Hybrid Split-View / Slide-in Details Panel (keyboard `j`/`k`/`↑`/`↓`/`Enter`/`Esc` + mobile touch bottom sheet), Inline Target Price Alerts, Source Adapters Diagnostics with 1-click Reset/Unpause, Steam Family Sharing Exclusions with 1-click Storefront Category 62 checking, Data Safety error review, and 14-column CSV export.
- **REST & Real-Time APIs:**
  - Standard SPA routes: `/api/profiles`, `/api/games`, `/api/sources`, `/api/sources/:code/reset`, `/api/sync`, `/api/pricing-errors`, `/api/family-sharing/exclusions`, `/api/family-sharing/auto-detect`, `/api/export/offers.csv`.
  - Server-Sent Events (SSE): `/api/sync/events` for live per-game synchronization telemetry.
  - Anti-Rate-Limit v1 API: `/api/v1/offers/batch` (bulk pricing up to 250 games), `/api/v1/games/resolve` (bulk AppID/title match), `GET /api/v1/games` with ETag `304 Not Modified` caching and standard IETF rate-limit headers.
- **Data Sources & Paced Adapters:**
  - **Steam Storefront:** Canonical wishlist ingestion + base price/review baseline + official Category 62 Family Sharing validation (Pacing: 2000ms, jitter 250ms).
  - **IsThereAnyDeal (ITAD v2/v3):** High-batch official store aggregator for 40+ stores with chunk-isolated failure resilience (Pacing: 1000ms, jitter 200ms).
  - **CheapShark:** True multi-AppID comma-separated batching (25 App IDs per request, `pageSize=60`, up to 3 pages pagination, Metacritic review/score enrichment, 429 single re-enqueue backoff, Pacing: 1500ms, jitter 250ms).
  - **GG.deals:** Hybrid official + marketplace deal aggregator with `SOURCE_FAMILY_CONFLICT` detection ($\ge 5.0\times$ extreme conflict) and `OVER_MSRP` detection (Pacing: 1500ms, jitter 300ms).
  - **AllKeyShop:** Unofficial internal JSON endpoints via anti-bot solver (Byparr / FlareSolverr) with adaptive check backoff (24h to 168h), fair round-robin scheduling, exponential jitter, dual-layer page & API fallback, phantom 0.02 EUR guardrails, and solver error propagation (Pacing: 2500ms, jitter 500ms).
- **Canonical Type System:** Single Source of Truth in [`src/shared/types.ts`](file:///D:/github/Pricetool/src/shared/types.ts), defining unified models (`Game`, `Offer`, `PricingErrorEvaluation`, `PricingErrorType`, `PriceEventType`, `DealScoreBreakdown`, `DealVerdict`, `WishlistEntry`).

---

## 🧠 Core Intelligence & Decision Engines

### 1. Deal Score v2.3 (`src/server/domain/dealScore/`)
Trust-free, monotonic mathematical scoring formula mapping deals onto a 0–100 scale:
$$\text{RawScore} = S_{\text{atl}} (0\text{--}40) + S_{\text{disc}} (0\text{--}30) + S_{\text{hist}} (0\text{--}20) + S_{\text{mkt}} (0\text{--}10)$$

1. **$S_{\text{atl}}$ (Proximity to All-Time Low, 0–40 pts):** Matches confirmed ATL awards 36 points base. Undercutting confirmed ATL awards up to +4 points bonus (maxing at 20% undercut). Unconfirmed or single-source ATL is penalized by 50%.
2. **$S_{\text{disc}}$ (Discount Depth, 0–30 pts):** Diminishing-returns power curve:
   $$S_{\text{disc}} = 30 \times \left(\frac{\text{anchor} - \text{price}}{\text{anchor}}\right)^{0.75}$$
   Differentiates deep cuts without premature saturation while rewarding legitimate 50%–80% sales. Requires $\ge 10\%$ discount to award points. Fake baseline markup protection ($>1.5\times$ base price) drops score to 0.
3. **$S_{\text{hist}}$ (Historical Sale Distribution, 0–20 pts):** Evaluates price position relative to typical historical sale median (derived via Tukey's IQR Fences).
4. **$S_{\text{mkt}}$ (Cross-Market Position, 0–10 pts):** Measures competitiveness across all fresh peer offers in the market. Official store single offers receive a default score of 7.
- **Safety Caps & Reservations:**
  - **Provisional History Cap:** If $<5$ samples: $\ge 60\%$ discount capped at 80 (85 for official store); some history capped at 65; no history capped at 40.
  - **Stale History Cap:** Price observations $>90$ days old are capped at 60.
  - **Score 100 Reservation:** Score is capped at 99 unless the price beats the confirmed ATL by $\ge 5\%$.
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
  - `MARKET_OUTLIER`: Enforces the approved 0.55 threshold (`currentPrice < secondCheapest * 0.55`) on the cheapest comparable offer with a meaningful gap ($\ge 2.00\text{ €}$). Clustered market sales (e.g. *Terminator Resistance*) produce zero false positives.
  - `SOURCE_FAMILY_CONFLICT`: Strictly assigned to Keyshop tiers (never official retail offers). Flags extreme price conflicts ($\ge 5.0\times$ or sub-euro $\ge 3.0\times$) between keyshop and official listings from the same source, while standard 2.0x–4.9x sales are recognized as legitimate. Bypassed when peer corroboration exists.
  - `DECIMAL_SHIFT`: Distinguishes authorized official publisher sales on budget titles (e.g. €0.89 on €8.99 MSRP) from genuine sub-euro pricing glitches on premium titles (€0.59 on €19.99 MSRP), missing digit shifts ($\sim 1/10$ or $\sim 1/100$ on MSRP $\ge 30\text{ €}$), or extreme drops ($\le 3\%$ on MSRP $\ge 15\text{ €}$).
  - `FAKE_BASELINE`: Restricted to offers claiming discounts below Steam base price (`price < steamBasePriceEur && claimedOriginalPriceEur > 1.5 * steamBasePriceEur`), eliminating false positives on deluxe editions priced above base MSRP.
  - `BELOW_ATL_IMPLAUSIBLE`: Price $>50\%$ below established confirmed ATL.
  - `OWN_HISTORY_BREAK`: Sudden price collapse vs merchant's own historical median ($z > 2.5$). Not sufficient by itself to create a HIGH anomaly when live market peers corroborate the price.
  - `FRESH_RELEASE_DROP`: $>40\%$ drop on games released $<30$ days ago without publisher confirmation.
  - `EDITION_INVERSION`: Deluxe/Gold edition priced $>30\%$ below the base game.
- **Independent Peer Corroboration:** $\ge 2$ independent fresh peer prices within $\pm 40\%$ override pricing errors (`SUB_EURO_PREMIUM_GLITCH_CORROBORATED`), preventing false alarms on authentic coordinated sales.
- **Self-Healing & Auto-Dismissal:**
  - Startup checks and post-sync sweeps automatically dismiss pricing errors when the price has increased, when the offer was unflagged, or when another valid offer is cheaper.
  - `purgeCorruptedPricingErrors()` in `cleanData.ts` automatically dismisses legacy false-positive records and unflags offers, restoring them to Best Deals.
  - Glitched offers have `is_likely_pricing_error = 1`, excluding them from best deal selection.

### 3. Best Deal Selection & ATL Auto-Reconciliation
- **Ranking Hierarchy:** Fresh safe offers ($\le 72\text{h}$) strictly take precedence over stale safe offers, which take precedence over cheaper glitched offers:
  $$\text{Freshness Tier } (0 \text{ if } \le 72\text{h else } 1) \rightarrow \text{price\_eur ASC} \rightarrow \text{last\_observed\_at DESC}$$
- **Auto-Reconciliation:**
  - When `recomputeBestDealForGame` identifies a safe valid offer cheaper than `game.historical_low_eur`, it immediately reconciles `historical_low_eur` with the new price, timestamp, and source.
  - Batch SQL sweeps (`BEST_DEAL_RECOMPUTE_ALL_SQL`) and startup reconciliations heal any historical low discrepancies across the entire database.

### 4. Price Intelligence & Decision Advisor (`src/server/domain/priceIntelligence/`)
- **Period Lows:** Non-synthetic 7-day, 30-day, 90-day, and 1-year lows (returns `null` when tracking history is shorter than the period).
- **Typical Sale Price:** Computed using Tukey's Interquartile Range (IQR) Fences across discount observations ($\ge 15\%$ off) to establish true median, $Q1$, and $Q3$.
- **Price Volatility (CV):** Relative standard deviation on observed calendar days (`Stable`, `Moderate`, `Volatile`).
- **Sale Drop Frequency:** Annual discount rhythm (`Frequent`, `Regular`, `Rare`).

---

## 🗄️ Database & Migration Architecture

- **Engine:** SQLite 3 via `better-sqlite3` in WAL mode (`PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`, `PRAGMA foreign_keys = ON`).
- **Migrations (001–026):** Managed sequentially via `src/server/db/migrations.ts`:
  - `022_add_pricing_errors_table_and_columns`: Replaced legacy anomaly tables with `pricing_errors` table, added pricing error columns to `offers`, added `steam_assets` table.
  - `023_drop_merchant_trust_score`: Dropped artificial trust score from `merchants`.
  - `024_post_migration_indexes_and_anomalies_view`: Created composite indexes and backward-compatible `anomalies` view with `INSTEAD OF` triggers.
  - `025_add_games_is_delisted`: Added `is_delisted` flag to `games`.
  - `026_cleanup_false_sub_euro_glitches`: Dismissed false sub-euro errors on offers $\ge 1.005\text{ €}$, unflagged offers, and recomputed best deals.
- **Core Schema Tables:**
  - `profiles`: Steam accounts and family sharing markers.
  - `games`: Metadata, MSRP, historical low, deal score stats, review scores, SteamDB rating, Metacritic score & URL, delisted flag.
  - `wishlist_entries`: Profile-to-game mappings, priorities, target prices.
  - `merchants`: Official vs keyshop stores (no synthetic trust score).
  - `offers`: Canonical deduplicated offers, normalized EUR prices, raw prices/currencies, pricing error flags.
  - `source_observations`: Raw provenance records per adapter for each offer.
  - `price_history`: Immutable price change snapshots with `is_pricing_error` flag and deal score.
  - `pricing_errors`: Isolated error detection records with dismissal state.
  - `steam_assets`: Cached high-resolution artwork keyed by `(steam_app_id, asset_type)`.
  - `family_owned_apps`: Steam Family Sharing library tracking.
  - `notifications_log`: Discord webhook rate-limiting and alert deduplication.

---

## 🚀 Key Commands & Verification

```bash
# 1. Typecheck (TypeScript compiler check)
npm run typecheck      # tsc --noEmit

# 2. Automated Test Suite
npm test               # vitest run --fileParallelism=false (73 test files, 716 tests)
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
| [`src/server/domain/dealScore/`](file:///D:/github/Pricetool/src/server/domain/dealScore/) | Deal Score v2.3 calculator, confidence, tiers, and legacy helpers |
| [`src/server/domain/pricingError/`](file:///D:/github/Pricetool/src/server/domain/pricingError/) | Pricing error detector, price event classifier, and self-healing logic |
| [`src/server/domain/priceIntelligence/`](file:///D:/github/Pricetool/src/server/domain/priceIntelligence/) | Purchase advice advisor, IQR typical sale, period lows, volatility |
| [`src/server/sources/`](file:///D:/github/Pricetool/src/server/sources/) | Multi-source adapters (`steam.ts`, `itad.ts`, `cheapshark.ts`, `ggdeals.ts`, `allkeyshop.ts`, `base.ts`) |
| [`src/server/sync/`](file:///D:/github/Pricetool/src/server/sync/) | Rate limiters (`rateLimiter.ts`), circuit breakers (`circuitBreaker.ts`), sync orchestrator (`orchestrator.ts`) |
| [`src/server/db/`](file:///D:/github/Pricetool/src/server/db/) | Schema (`schema.ts`), migrations (`migrations.ts`), repositories (`repositories/`), core instance (`core.ts`) |
| [`src/server/routes/`](file:///D:/github/Pricetool/src/server/routes/) | REST API handlers (`api.ts`), anti-rate-limit API (`v1.ts`), SSE stream |
| [`src/client/src/`](file:///D:/github/Pricetool/src/client/src/) | React 19 SPA components, hooks, modals, and design system styles |
| [`docs/`](file:///D:/github/Pricetool/docs/) | Comprehensive Markdown architectural guides and API references |
