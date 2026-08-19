# ⚡ Pricetool — Steam Wishlist Price Aggregator & Intelligence Engine

> **Personal self-hosted, cache-first game deal tracker and price intelligence engine designed to track 2000+ Steam Wishlist games reliably without aggressive scraping or IP bans.**

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/Version-1.6.0-blue.svg)](./package.json)
[![Tests](https://img.shields.io/badge/Tests-200%2F200%20Passed-emerald.svg)](./tests)
[![Platform](https://img.shields.io/badge/Platform-Linux%20x86--64-slate.svg)]()

---

## 🌟 What is Pricetool?

Pricetool is a high-performance, single-container self-hosted web application that monitors game deals across multiple official digital storefronts and marketplace keyshops using your **Steam Wishlist** as its primary input.

It solves the challenge of monitoring large wishlists (2000+ games) with a **respectfully paced multi-source adapter architecture**, automatic canonical offer deduplication, historical low tracking, an advanced **2D Pricing Engine**, an explainable **Deal Score (0–100)**, and a **Price Intelligence Advisor (BUY / FAIR / WAIT)** with interactive SVG timeline charts.

---

## 🚀 Key Features

### 1. Multi-Source Aggregation & Deduplication
* **Steam Wishlist Ingestion**: Fast paginated batch import using Steam64 ID or Custom Profile URL.
* **IsThereAnyDeal (ITAD)**: Primary batch aggregator covering 40+ official stores (Steam, Humble, Fanatical, GOG, GMG, Gamesplanet, etc.) with verified historical records.
* **CheapShark**: High-speed public batch API covering 25+ official retailers (Steam, Green Man Gaming, Fanatical, GOG, Epic Games, GameBillet, etc.) without requiring an API key.
* **AllKeyShop (vaks.php v2 API)**: Structured keyshop intelligence (Eneba, Kinguin, CDKeys, Instant Gaming, Gamivo, etc.) with real-time voucher and merchant breakdowns.
* **GG.deals**: Direct official retail and marketplace cross-verification.
* **Canonical Deduplication**: Multiple adapters observing the same store (e.g. Fanatical reported by both ITAD and CheapShark) collapse into a single canonical offer backed by multi-source observations (`source_observations`).
* **Dynamic Currency Handling**: Preserves raw source currencies (`USD`, `GBP`, `HUF`, `EUR`) alongside normalized EUR prices using daily ECB exchange rates.

### 2. 2D Pricing Engine & Anomaly Detection
* **Decoupled Magnitude & Risk**: Separates price drop significance (`PriceEventType`) from data risk (`PriceRiskLevel`).
* **Multi-Signal Corroboration**: Dampens false alarms when multiple independent sources agree, while isolating unverified sub-euro anomalies (e.g. 0.49 € on a 60 € game) with a strict Deal Score hard-cap (max 35).

### 3. Computed Deal Score (0–100) & Deal Discovery
* **4-Pillar Transparent Scoring**:
  * **Discount Pillar (0–45 pts)**: Scales linearly with discount depth.
  * **Historical Pillar (0–35 pts)**: Rewards `NEW_HISTORICAL_LOW` (+35), `AT_HISTORICAL_LOW` (+28), and `NEAR_HISTORICAL_LOW` (+20).
  * **Trust Pillar (0–20 pts)**: Official retailer (+10) and multi-source consensus (+4 to +10).
  * **Risk Penalties & Confidence**: Multiplier based on data freshness and evidence depth.
* **Best Deals Dashboard**: Top deals carousel ranked by Deal Score with tier badges (`Exceptional`, `Great`, `Fair`, `Weak`).
* **Wishlist Statistics**: Live overview of total games, active discounts, confirmed all-time lows, major drops, and average savings.
* **Smart Filter Bar**: Filter by Major Deals ($\ge 50\%$ off or $\ge 15\text{ €}$ drop), Confirmed ATL, Trusted Stores Only, and Maximum Price.

### 4. Price Intelligence & Decision Advisor
* **BUY / FAIR / WAIT Advice**: Deterministic recommendation engine explaining *why* a deal is worth buying now or if you should wait, backed by factual reasons.
* **Rolling Period Lows**: Tracks 7-day, 30-day, 90-day, 1-year, and confirmed All-Time Low (ATL) from trusted offers. If history is incomplete, fields are explicitly reported as `null` without fabricating synthetic assumptions.
* **Typical Sale Price**: Statistical IQR (Tukey's Fences) outlier filtering computes the true historical median sale price without distortion from glitches.
* **Price Volatility (CV)**: Calculates coefficient of variation on observed calendar days to classify pricing as `Stable`, `Moderate`, or `Volatile`.
* **Sale Drop Frequency**: Evaluates annual discount rhythm (`Frequent`, `Regular`, `Rare`).
* **Price vs Market**: Ranks best deal against all active compatible regional offers (`GLOBAL`, `EU`, `HU`).
* **Interactive SVG Price Chart**: Stepped price movement timeline with Steam MSRP baseline, ATL dashed line, Typical Sale band, and hover tooltips.

### 5. Multi-View Architecture & Free Games Separation (2,500+ Games Support)
* **Dedicated Free-to-Play Section**: Free games (`is_free = 1`) are separated into their own navigation tab with direct Steam launcher (`steam://run/<id>`) and store links, keeping the paid deal catalog clean.
* **3 Ergonomic View Modes**:
  * 🔲 **Grid View**: Rich visual card layout with cover artwork, discount flags, and Deal Score badges.
  * 📄 **Compact List View**: Clean single-line horizontal strips for fast vertical scanning.
  * 📊 **Dense Data Table View**: Highly compact multi-column data table showing Rank, Title, MSRP, Best Price, Discount %, Deal Score, Store, and ATL in tabular rows.
* **High-Capacity Pagination**: Adjustable page limits (24, 50, 100, 200 items per page) and persistent user view preferences via `localStorage`.

### 6. Anti-Rate-Limit v1 REST API & Batch Pricing
* **`POST /api/v1/offers/batch`**: Bulk query resolving best prices, Deal Scores, and stores for up to 250 Steam games in a single request.
* **`POST /api/v1/games/resolve`**: T-shirt sized ID and title matching against SQLite database.
* **ETag & IETF Rate Limit Headers**: RFC-compliant caching (`304 Not Modified`) and standard `X-RateLimit-*` headers.

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

# 3. Run test suite (20 test suites / 200 unit & integration tests)
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
* `/data/pricetool.db` — SQLite database running in WAL (Write-Ahead Logging) mode with cached C++ prepared statements.
* `/data/pricetool.db-wal` & `/data/pricetool.db-shm` — Write-ahead buffers for non-blocking concurrent reads.

In Docker, `./data` on the host is mapped to `/data` in the container. Upgrades and container rebuilds **never** destroy your wishlist, observations, or price history.

---

## ⚠️ Steam Privacy Requirement

To import your wishlist, your **Steam Profile** and **Game Details** privacy settings must be set to **Public** in Steam Community (`Profile -> Edit Profile -> Privacy Settings -> My profile: Public, Game details: Public`).

Pricetool does not require, store, or automate Steam account credentials, session cookies, or private tokens.

---

## 📚 Documentation

* [`docs/user-guide.md`](./docs/user-guide.md) — User guide: Price Events, Risk Levels, Deal Score, Period Lows, and Buy/Fair/Wait advisor.
* [`docs/architecture.md`](./docs/architecture.md) — System architecture, rate limiting, and circuit breaker engine.
* [`docs/data-model.md`](./docs/data-model.md) — Complete SQLite schema, indexes, and entity relationships.
* [`docs/sync.md`](./docs/sync.md) — Sync orchestrator, queue token buckets, and multi-source pacing.
* [`docs/sources.md`](./docs/sources.md) — Source comparison matrix, rate limits, and API analysis.
* [`docs/development.md`](./docs/development.md) — Development workflow, testing guidelines, and CI/CD.
* [`CHANGELOG.md`](./CHANGELOG.md) — Version history from v1.0.0 through v1.4.0.

---

## 📄 License
MIT License. Built for personal, self-hosted game price intelligence.
