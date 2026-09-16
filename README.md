# ⚡ Pricetool — Steam Wishlist Price Aggregator & Intelligence Engine

> **Personal self-hosted, cache-first game deal tracker and price intelligence engine designed to track 2,000+ Steam Wishlist games reliably without aggressive scraping or IP bans.**

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/Version-2.3.0-blue.svg)](./package.json)
[![Tests](https://img.shields.io/badge/Tests-624%2F624%20Passed-emerald.svg)](./tests)
[![Platform](https://img.shields.io/badge/Platform-Linux%20x86--64-slate.svg)]()

---

## 🌟 What is Pricetool?

Pricetool is a high-performance, single-container self-hosted web application that monitors game deals across multiple official digital storefronts and marketplace keyshops using your **Steam Wishlist** as its primary input.

It solves the challenge of monitoring large wishlists (2,000+ games) with a **respectfully paced multi-source adapter architecture**, automatic canonical offer deduplication, historical low auto-reconciliation, an advanced **Pricing Error Engine with Self-Healing**, an explainable mathematical **Deal Score v2.3 (0–100)**, and a **Price Intelligence Advisor (BUY / FAIR / WAIT)** with interactive SVG timeline charts.

---

## 🚀 Key Features

### 1. Multi-Source Aggregation & Respectful Pacing
* **Steam Wishlist Ingestion**: Fast paginated batch import using Steam64 ID or Custom Profile URL (Pacing: 2000ms delay, 250ms jitter).
* **IsThereAnyDeal (ITAD v2/v3)**: Primary batch aggregator covering 40+ official stores (Steam, Humble, Fanatical, GOG, GMG, Gamesplanet, WinGameStore, etc.) with verified historical records (Pacing: 1000ms delay, 200ms jitter, up to 200 games per batch).
* **CheapShark True Multi-AppID Batching**: Public batch API covering 25+ official retailers (Steam, Green Man Gaming, Fanatical, GOG, Epic Games, GameBillet, etc.) without requiring an API key. Bundles **25 Steam App IDs per comma-separated request** (`/api/1.0/deals?steamAppID=id1,id2,...&pageSize=60`), handles pagination up to 3 pages, enriches Metacritic scores and review links, and gracefully re-enqueues on 429 backoff (Pacing: 1500ms delay, 250ms jitter).
* **GG.deals**: Direct official retail and marketplace cross-verification (Pacing: 1500ms delay, 300ms jitter).
* **AllKeyShop (Internal API via Solver)**: Structured keyshop intelligence (Eneba, Kinguin, CDKeys, Instant Gaming, Gamivo, etc.) with real-time voucher and merchant breakdowns. Strictly routed through an anti-bot solver (Byparr / FlareSolverr) with adaptive check backoff (24h to 168h intervals) and exponential jitter (Pacing: 2500ms delay, 500ms jitter).
* **Canonical Deduplication**: Multiple adapters observing the same store (e.g. Fanatical reported by both ITAD and CheapShark) collapse into a single canonical offer backed by multi-source observations (`source_observations`).
* **Dynamic Currency Handling**: Preserves raw source currencies (`USD`, `GBP`, `HUF`, `EUR`) alongside normalized EUR prices using daily ECB exchange rates.
* **Epoch-Aware Rate Limit Parsing**: Handles delta seconds, HTTP-dates, and Unix epoch timestamps (from Cloudflare `X-RateLimit-Reset` and `ratelimit-reset` headers).

### 2. Pricing Error Engine & Self-Healing
* **Dedicated Data Safety Architecture**: Isolates suspected pricing errors from best-deal selection and Deal Score calculation into a dedicated `pricing_errors` system with full dismissal lifecycle.
* **Multi-Signal Error Classification**: Automatic categorization for `DECIMAL_SHIFT` (sub-euro glitches $\le 1.005\text{ €}$ on premium titles, missing digit shifts $\sim 1/10$ or $\sim 1/100$ on MSRP $\ge 30\text{ €}$, extreme drops $\le 3\%$ on MSRP $\ge 15\text{ €}$), `MARKET_OUTLIER`, `BELOW_ATL_IMPLAUSIBLE`, `OWN_HISTORY_BREAK`, `FRESH_RELEASE_DROP`, `EDITION_INVERSION`, and `FAKE_DISCOUNT`.
* **Independent Merchant Corroboration**: When $\ge 2$ independent fresh peer prices match within $\pm 40\%$, pricing error flags are safely overridden (`SUB_EURO_PREMIUM_GLITCH_CORROBORATED`), eliminating false alarms on genuine publisher flash sales.
* **Automated Self-Healing**: Database startup sweeps and post-sync hooks automatically dismiss pricing errors when prices increase, when offers are unflagged, or when cheaper valid offers exist.
* **Discord Glitch Hunter**: Real-time push alerts to Discord webhooks with crimson red embeds linking directly to the flagged offer and reporting error confidence.

### 3. Computed Deal Score v2.3 (0–100)
* **4-Pillar Transparent Mathematical Scoring**:
  * **$S_{\text{atl}}$ (Proximity to All-Time Low, 0–40 pts)**: Matches confirmed ATL awards 36 points base. Undercutting confirmed ATL awards up to +4 points bonus (maxing at 20% undercut). Unconfirmed or single-source ATL is penalized by 50%.
  * **$S_{\text{disc}}$ (Discount Depth, 0–30 pts)**: Diminishing-returns curve:
    $$S_{\text{disc}} = 30 \times \left(\frac{\text{anchor} - \text{price}}{\text{anchor}}\right)^{0.75}$$
    Smoothly differentiates deep sales without premature saturation while preserving healthy scores for standard 50%–80% discounts ($\ge 10\%$ discount required).
  * **$S_{\text{hist}}$ (Historical Sale Distribution, 0–20 pts)**: Evaluates price position against the typical sale median.
  * **$S_{\text{mkt}}$ (Cross-Market Position, 0–10 pts)**: Evaluates competitiveness among all fresh peer offers.
* **Safety Caps & Reservations**:
  * **Provisional Cap**: Capped at 40 (no history), 65 (some history), or 80/85 (deep discount $\ge 60\%$) when $<5$ samples are recorded.
  * **Stale History Cap**: Capped at 60 when observations are $>90$ days old.
  * **Score 100 Reservation**: Capped at 99 unless the price beats the confirmed ATL by $\ge 5\%$.
* **Best Deals Dashboard**: Top deals carousel ranked by Deal Score with aligned tier badges (`Exceptional` $\ge 80$, `Great` $\ge 60$, `Fair` $\ge 40$, `Weak` $< 40$).
* **Wishlist Statistics**: Live overview of total games, active discounts, confirmed all-time lows, active pricing errors, and average savings.
* **Smart Filter Bar**: Filter by Major Deals, Confirmed ATL, Trusted Stores Only, Active Anomalies, Maximum Price, Family Shared, and Delisted games.

### 4. Best Deal Selection & ATL Auto-Reconciliation
* **Canonical Freshness Hierarchy**: Best deal selection strictly prioritizes:
  $$\text{Fresh Safe Offers } (\le 72\text{h}) > \text{Stale Safe Offers} > \text{Glitched Offers (Excluded)}$$
* **Instant ATL Auto-Reconciliation**: Whenever a safe valid offer undercuts the recorded `historical_low_eur`, the system automatically updates the game's historical low price, date, and source without manual intervention.

### 5. Price Intelligence & Decision Advisor
* **BUY / FAIR / WAIT Advice**: Deterministic recommendation engine explaining *why* a deal is worth buying now (`INSTANT_BUY`, `GREAT_DEAL`, `FAIR_DEAL`, `WAIT`, `OVERPRICED`).
* **Rolling Period Lows**: Tracks 7-day, 30-day, 90-day, 1-year, and confirmed All-Time Low (ATL) from trusted offers. If history is incomplete, fields are explicitly reported as `null` without fabricating synthetic assumptions.
* **Typical Sale Price**: Statistical IQR (Tukey's Fences) outlier filtering computes the true historical median, $Q1$, and $Q3$ sale prices without distortion from glitches.
* **Price Volatility (CV)**: Calculates coefficient of variation on observed calendar days to classify pricing as `Stable`, `Moderate`, or `Volatile`.
* **Sale Drop Frequency**: Evaluates annual discount rhythm (`Frequent`, `Regular`, `Rare`).
* **Interactive SVG Price Chart**: Stepped price movement timeline with Steam MSRP baseline, ATL dashed line, Typical Sale band, and hover tooltips.

### 6. Multi-View Architecture & Free Games Separation (2,500+ Games Support)
* **Dedicated Free-to-Play Section**: Free games (`is_free = 1`) are separated into their own navigation tab with direct Steam launcher (`steam://run/<id>`) and store links, keeping the paid deal catalog clean.
* **Steam Family Sharing Library Filter**: Sync and track games owned by family profiles to avoid purchasing games already accessible via Steam Family Sharing (`hideFamilyShared`).
* **Unreleased & Delisted Game Support**: Smart filters to hide unannounced/unreleased games (`hideUnreleased`) and track delisted titles (`is_delisted`).
* **3 Ergonomic View Modes**:
  * 🔲 **Grid View**: Rich visual card layout with cover artwork, discount flags, and Deal Score badges.
  * 📄 **Compact List View**: Clean single-line horizontal strips for fast vertical scanning.
  * 📊 **Dense Data Table View**: Highly compact multi-column data table showing Rank, Title, MSRP, Best Price, Discount %, Deal Score, Store, and ATL in tabular rows.
* **High-Capacity Pagination**: Adjustable page limits (24, 50, 100, 200 items per page) and persistent user view preferences via `localStorage`.

### 7. Anti-Rate-Limit v1 REST API & Batch Pricing
* **`POST /api/v1/offers/batch`**: Bulk query resolving best prices, Deal Scores, and stores for up to 250 Steam games in a single request.
* **`POST /api/v1/games/resolve`**: Bulk Steam AppID and title matching against SQLite database.
* **ETag & IETF Rate Limit Headers**: RFC-compliant caching (`304 Not Modified`) and standard `X-RateLimit-*` headers.
* **CSV Export (`GET /api/export/offers.csv`)**: 14-column spreadsheet export of all active offers and error evaluations.

---

## ⚡ Quick Start (Docker Compose)

### 1. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` (optional API keys enhance coverage):
```env
PORT=3000
DATA_DIR=/data
CACHE_TTL_HOURS=6
STEAM_DELAY_MS=2000
ITAD_DELAY_MS=1000
CHEAPSHARK_DELAY_MS=1500
GGDEALS_DELAY_MS=1500
ITAD_API_KEY=               # Optional: Free key from https://isthereanydeal.com/dev/app/
GGDEALS_API_KEY=            # Optional: Free key from https://gg.deals/api/
```

### 2. Run Container
```bash
docker compose up -d
```

Open **`http://localhost:3000`** in your browser!

---

## 🛠️ Local Development

### Prerequisites
* Node.js 22 LTS or later
* npm 10+

### Setup & Commands
```bash
# 1. Install dependencies
npm install

# 2. Run Fastify backend and React 19 frontend concurrently with hot-reload
npm run dev

# 3. Run test suite (68 test files / 624 unit & integration tests)
npm test

# 4. Run TypeScript typecheck
npm run typecheck

# 5. Build production bundle (Vite SPA + TypeScript Server)
npm run build

# 6. Start production server locally
npm start
```

---

## 💾 Data Persistence & Architecture

All persistent runtime data is stored in the `/data` directory:
* `/data/pricetool.db` — SQLite database running in WAL (Write-Ahead Logging) mode with cached prepared statements.
* `/data/pricetool.db-wal` & `/data/pricetool.db-shm` — Write-ahead buffers for non-blocking concurrent reads.

In Docker, `./data` on the host is mapped to `/data` in the container. Upgrades and container rebuilds **never** destroy your wishlist, observations, or price history.

### 🌐 Fonts & External Assets
The web interface loads typography (Inter and JetBrains Mono) from Google Fonts CDN (`src/client/index.html`). In offline or air-gapped deployments, standard system fonts (`sans-serif` and `monospace`) are used automatically as fallbacks.

---

## ⚠️ Steam Privacy Requirement

To import your wishlist, your **Steam Profile** and **Game Details** privacy settings must be set to **Public** in Steam Community (`Profile -> Edit Profile -> Privacy Settings -> My profile: Public, Game details: Public`).

Pricetool does not require, store, or automate Steam account credentials, session cookies, or private tokens.

---

## 📚 Documentation

Comprehensive architectural and user documentation is maintained in [`docs/`](file:///D:/github/Pricetool/docs/):
* [`docs/architecture.md`](file:///D:/github/Pricetool/docs/architecture.md) — System architecture, security posture, and runtime components.
* [`docs/data-model.md`](file:///D:/github/Pricetool/docs/data-model.md) — Database schema (migrations 001–026), entity relations, and index designs.
* [`docs/sources.md`](file:///D:/github/Pricetool/docs/sources.md) — Detailed adapter profiles, batching mechanisms, and rate limits.
* [`docs/sync.md`](file:///D:/github/Pricetool/docs/sync.md) — Queue orchestration, circuit breakers, and pricing error detection.
* [`docs/user-guide.md`](file:///D:/github/Pricetool/docs/user-guide.md) — Deal Score v2.3 mathematics, purchase advice advisor, and view modes.
* [`docs/development.md`](file:///D:/github/Pricetool/docs/development.md) — Environment variables, local setup, testing, and Docker CI/CD.
* [`PROJECT_SUMMARY.md`](file:///D:/github/Pricetool/PROJECT_SUMMARY.md) — Quick architectural summary for developers and AI agents.
* [`CHANGELOG.md`](file:///D:/github/Pricetool/CHANGELOG.md) — Complete release history and changes.
