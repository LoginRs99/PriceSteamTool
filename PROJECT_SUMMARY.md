# 🎮 PriceSteamTool — Project Summary & Architecture Guide

> **Quick Summary for New Sessions & Developers**  
> Complete technical reference is available in [`docs/architecture.md`](file:///D:/github/Pricetool/docs/architecture.md), [`docs/data-model.md`](file:///D:/github/Pricetool/docs/data-model.md), and [`docs/user-guide.md`](file:///D:/github/Pricetool/docs/user-guide.md).

---

## 📌 TL;DR Overview (v1.7.1+)

PriceSteamTool is an open-source, privacy-first, self-hosted Steam Wishlist Price Aggregator and Deal Intelligence platform built on:
- **Backend:** Node.js 22+, Fastify 5, TypeScript, Better-SQLite3 (WAL mode, prepared statement caching, composite indexing, foreign keys).
- **Frontend:** React 19, TypeScript, Vite, Vanilla CSS (Tailwind-free custom design system) with grouped Data Safety view & CSV export.
- **APIs:** Legacy SPA routes (`/api/*`) + Anti-Rate-Limit REST API (`/api/v1/*`) with `POST /api/v1/offers/batch`, `POST /api/v1/games/resolve`, `GET /api/export/offers.csv`, ETag `304` caching, and IETF rate limit headers.
- **Sources:** Steam Storefront, IsThereAnyDeal (ITAD v2), CheapShark Batch, GG.deals, AllKeyShop.
- **Type Architecture:** Canonical Single Source of Truth in [`src/shared/types/index.ts`](file:///D:/github/Pricetool/src/shared/types/index.ts), defining unified models (`PricingErrorEvaluation`, `PricingErrorType`, `PriceEventType`, `DealScoreBreakdown`, `Game`, `Offer`, `WishlistEntry`).
- **Core Intelligence Engines:**
  - **Deal Score v2 (`src/server/domain/dealScore/`):** Unified 0–100 monotonic mathematical scoring with discount vs base price, confirmed ATL delta, historical volatility (IQR/effective sigma), and fresh market consensus (base score folded into single formula).
  - **Pricing Error Detector (`src/server/domain/pricingError/`):** Replaces legacy anomaly engine with multi-factor price error evaluation (`SUB_EURO_PREMIUM_GLITCH`, `LONE_BOTTOM_OUTLIER`, `EXTREME_PERCENTAGE_DROP`, `SUSPECTED_EDITION_INVERSION`), independent merchant corroboration override (≥2 fresh peer prices within ±40%), and decoupled price movement event classification (`PRICE_INCREASE`, `ALL_TIME_LOW`, `DEEP_DISCOUNT`, `EXTREME_DROP`, `ON_SALE`).
  - **Data Confidence:** 0–100% confidence rating based on sample size, history timespan, and multi-source consensus.
  - **Action Signal Engine:** Context-aware purchase recommendation (`BUY_NOW`, `STRONG_BUY`, `FAIR_DEAL`, `WAIT`, `MONITOR`).
  - **Price History Seeding:** One-time historical price ingestion pipeline with rate-limited background queue and lazy fast-tracking for active wishlist titles.
  - **Adaptive Keyshop Pacing:** Fair round-robin due-game sorting, exponential-tailed jitter, self-tuning exponential backoff (24h -> 168h ceiling) on stable prices with active target price override, Byparr solver integration, and User-Agent rotation.
  - **Discord Webhook Alerts:** Multi-tier deal notifications with provisional filtering, target price hit alerts, and post-enrichment keyshop deal dispatch.
  - **Library Intelligence:** Steam Family Sharing ownership synchronization (`hideFamilyShared`) and Unreleased/Coming Soon exclusion (`hideUnreleased`).

---

## 🗄️ Database & Migration Architecture

- **Engine:** SQLite 3 via `better-sqlite3` in WAL journal mode.
- **Migrations:** Sequential schema versioning up to `023_drop_merchant_trust_score`.
  - Migrations 022 & 023 introduced the new pricing error domain:
    - `offers`: tracks `is_likely_pricing_error`, `pricing_error_confidence`, `pricing_error_type`, and `pricing_error_reason`.
    - `pricing_errors`: dedicated table replacing legacy `anomalies` (with backward-compatible VIEW and triggers for query safety).
    - `price_history`: records `is_pricing_error` with `idx_price_history_reliable(game_id, is_pricing_error)`.
    - `steam_assets`: high-resolution asset and artwork cache table keyed by `(steam_app_id, asset_type)`.
    - `merchants`: simplified without artificial trust scores.
  - Best deal calculation (`BEST_DEAL_RECOMPUTE_ALL_SQL`) automatically excludes pricing errors (`AND is_likely_pricing_error = 0`).

---

## 🚀 Key Commands

```bash
npm run typecheck   # TypeScript check (tsc --noEmit)
npm test            # Run all 65 Vitest test suites (568 tests)
npm run build       # Build client (Vite) and server (TypeScript)
npm start           # Run production server
```

For full documentation of algorithms, data models, and recent changelog, see [`docs/`](file:///D:/github/Pricetool/docs/).
