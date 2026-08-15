# ⚡ Pricetool — Steam Wishlist Price Aggregator

> **Personal self-hosted, cache-first game deal tracker and price aggregator designed to track 2000+ Steam Wishlist games reliably without aggressive scraping or IP bans.**

---

## 🌟 What is Pricetool?

Pricetool is a lightweight, single-container self-hosted web application that monitors game deals across multiple official digital storefronts and marketplace keyshops using your **Steam Wishlist** as its canonical input.

It solves the problem of tracking huge wishlists (2000+ games) by employing a **cache-first**, **respectfully paced queue architecture** with automatic multi-source deduplication, historical low tracking, and price anomaly detection.

---

## 🚀 Features

* **Steam Wishlist Primary Input**: Ingests your full Steam Wishlist via Steam64 ID or Profile URL.
* **Multi-Source Price Aggregation**:
  * **IsThereAnyDeal (ITAD)**: Primary batch aggregator covering 40+ official stores (Steam, Humble, Fanatical, GOG, GMG, Gamesplanet, etc.) with verified historical lows.
  * **GG.deals**: Official retail + marketplace keyshop coverage (K4G, Kinguin, CDKeys, Eneba, Gamivo).
  * **CheapShark**: Instant public cross-verification and `cheapestPriceEver` historical tracking.
  * **AllKeyShop & GoCDKeys**: Polite fallback adapters with fast-fail circuit breakers (disabled by default).
* **Respectful Rate Limiting & Circuit Breakers**:
  * Decoupled queues with token-bucket pacing and jitter.
  * 4-State Circuit Breaker (`NORMAL` → `BACKOFF` → `PAUSED` → `COOLDOWN`).
  * Failures on one source never block or stall other active adapters.
* **Cache-First Architecture**:
  * Avoids redundant requests on unchanged items; only queries stale/missing items based on configurable TTL.
* **Offer Deduplication & Provenance**:
  * Canonical merchant matching across sources (`Verified by ITAD + GG.deals`).
* **Price Anomaly & Glitch Scoring**:
  * Rule-based detector flags suspicious errors without hiding the deal.
* **Price History & Historical Lows**:
  * Idempotent price history tracking and proven historical lows.
* **Modern Dark Gamer UI**:
  * Responsive, fast card grid with pagination (48/page), instant search, and quick filters (`On Sale`, `Historical Low`, `Under €10`, `Official Stores`, `Anomalies`).
  * Live real-time sync progress banner via Server-Sent Events (SSE).
  * Modal with all store offers, trust badges, and price history timeline.
* **Multi-Profile Support**:
  * Track and switch between multiple Steam wishlist accounts.
* **Zero Data Loss Docker Architecture**:
  * Single lightweight container with SQLite (WAL mode) on persistent `/data` volume.
  * Non-root `node` user security and container healthchecks.
* **Automated GHCR Deployment**:
  * Automated GitHub Actions workflow publishing multi-tagged Docker images to GitHub Container Registry.

---

## ⚡ Quick Start (Docker Compose)

### 1. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` (optional API keys):
```env
PORT=3000
DATA_DIR=/data
CACHE_TTL_HOURS=6
ITAD_API_KEY=               # Optional: Free key from https://isthereanydeal.com/dev/app/
GGDEALS_API_KEY=            # Optional: Free key from https://gg.deals/api/
```

### 2. Pull & Run
```bash
# Pull image from GHCR or build locally
docker compose up -d
```

Open **`http://localhost:3000`** in your browser!

---

## 🛠️ Local Development

### Prerequisites
* Node.js 22 LTS or later
* npm 10+

### Setup & Run
```bash
# Install dependencies
npm install

# Run backend (Fastify) and frontend (Vite) concurrently with hot-reload
npm run dev

# Run automated tests (24 unit & integration tests)
npm test

# Typecheck
npm run typecheck

# Build production bundle
npm run build
```

---

## 💾 Data Persistence

All persistent runtime data is stored in the `/data` directory:
* `/data/pricetool.db` — SQLite database with WAL (Write-Ahead Logging) mode.
* `/data/pricetool.db-wal` & `/data/pricetool.db-shm` — Write-ahead log buffers.

In Docker, `./data` on the host is mapped to `/data` in the container. Rebuilding or updating the container does **not** destroy your wishlist, price history, or configuration.

---

## ⚠️ Important Limitation

To fetch your wishlist via Steam Web API, your **Steam Profile** and **Game Details** privacy settings must be set to **Public** in Steam Community settings (`Profile -> Edit Profile -> Privacy Settings -> My profile: Public, Game details: Public`).

Pricetool does not store, request, or automate Steam account logins, passwords, session tokens, or private cookies.

---

## 📚 Technical Documentation

* [`docs/architecture.md`](./docs/architecture.md) — System design, component flows, security posture.
* [`docs/sources.md`](./docs/sources.md) — Source comparison matrix, rate limits, and API analysis.
* [`docs/data-model.md`](./docs/data-model.md) — SQLite schema, ER diagram, and deduplication logic.
* [`docs/sync.md`](./docs/sync.md) — Sync orchestrator, queue token buckets, and circuit breaker engine.
* [`docs/audit.md`](./docs/audit.md) — Deep technical audit findings and hardening log.
* [`docs/development.md`](./docs/development.md) — Development workflow, testing guidelines, and CI/CD.

---

## 📄 License
MIT License. Built for personal self-hosted use.
