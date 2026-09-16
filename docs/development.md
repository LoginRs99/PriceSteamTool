# Development & Deployment Guide

This guide covers local environment setup, testing, Docker orchestration, and the CI/CD pipeline for **Pricetool** (v2.3.0).

---

## 1. Project Directory Structure

```text
Pricetool/
├── .github/
│   └── workflows/
│       └── docker-publish.yml     # GitHub Actions CI/CD to GHCR (multi-arch build)
├── docs/                          # Architectural & user documentation
│   ├── user-guide.md              # User guide: Deal Score v2.3, Pricing Error Engine, Advisor
│   ├── architecture.md            # System architecture, security, and components
│   ├── sources.md                 # Source comparison, batching, and rate limiting
│   ├── data-model.md              # SQLite schema, migrations 001-026, and ER diagrams
│   ├── sync.md                    # Queue orchestration, circuit breakers, and pricing errors
│   ├── audit.md                   # Audit verification and validation reports
│   └── development.md             # This file
├── src/
│   ├── server/                    # Fastify backend & sync engine
│   │   ├── config/                # Environment variables, constants, and delay defaults
│   │   ├── db/                    # SQLite database & migrations (better-sqlite3)
│   │   │   ├── migrations.ts      # Migrations 001–026
│   │   │   ├── schema.ts          # Core SQLite schema
│   │   │   ├── core.ts            # getDb(), stmtCache, BEST_DEAL_RECOMPUTE_ALL_SQL
│   │   │   └── repositories/      # game, offer, merchant, profile, pricingError, source
│   │   ├── domain/                # Pricing Engine, Deal Score v2.3, Price Intelligence, Normalizer
│   │   │   ├── dealScore/         # 4-Pillar calculator, confidence, tiers
│   │   │   ├── pricingError/      # Pricing error detector, price events, self-healing
│   │   │   └── priceIntelligence/ # Purchase advice, IQR typical sale, period lows, volatility
│   │   ├── sources/               # Source adapters (ITAD, GGDeals, CheapShark, Steam, AllKeyShop)
│   │   ├── sync/                  # Job queue, rate limiters, circuit breakers, orchestrator
│   │   ├── routes/                # REST API routes (/api/*) & anti-rate-limit v1 (/api/v1/*)
│   │   └── index.ts               # Server entry point & graceful shutdown
│   ├── client/                    # Modern React 19 SPA (Vite)
│   │   ├── src/
│   │   │   ├── components/        # DealsDashboard, FilterBar, GameCard, GameDetailModal, PriceChart
│   │   │   ├── hooks/             # Custom hooks (useWishlist, useSyncProgress, useFilters)
│   │   │   ├── types/             # Frontend shared domain types
│   │   │   ├── App.tsx            # Main application
│   │   │   └── index.css          # Design system CSS tokens & styles
│   │   ├── index.html
│   │   └── vite.config.ts
│   └── shared/                    # Canonical domain types (src/shared/types.ts)
├── tests/                         # Automated unit & integration tests (68 files, 624 tests)
│   ├── unit/                      # Domain logic, Deal Score, Pricing Errors, Normalizers, Adapters
│   └── integration/               # Real-world 2000-game validation & production readiness tests
├── Dockerfile                     # Multi-stage production container
├── docker-compose.yml             # Local production compose
├── CHANGELOG.md                   # Release history
├── PROJECT_SUMMARY.md             # Project summary for developers and AI agents
├── package.json
├── tsconfig.json
└── README.md
```

---

## 2. Environment Variables

Create a `.env` file in the root directory (or pass via Docker environment):

```env
# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
DATA_DIR=/data
LOG_LEVEL=info

# API Keys (Optional but recommended for full coverage)
STEAM_API_KEY=                     # Optional: For private Steam profile resolve
ITAD_API_KEY=                      # Recommended: Free key from https://isthereanydeal.com/dev/app/
GGDEALS_API_KEY=                   # Optional: Free key from https://gg.deals/api/

# Safe Pacing & Delay Defaults (Milliseconds)
STEAM_DELAY_MS=2000                # Steam Storefront pacing (250ms jitter)
ITAD_DELAY_MS=1000                 # ITAD batch pacing (200ms jitter)
CHEAPSHARK_DELAY_MS=1500           # CheapShark multi-AppID batch pacing (250ms jitter)
GGDEALS_DELAY_MS=1500              # GG.deals pacing (300ms jitter)
ALLKEYSHOP_DELAY_MS=2500           # AllKeyShop pacing (500ms jitter)

# AllKeyShop Solver & Keyshop Pacing
ALLKEYSHOP_SOLVER_URL=             # Anti-bot solver (Byparr / FlareSolverr)
BYPARR_URL=                        # Alias for solver URL
ALLKEYSHOP_MAX_GAMES=30            # Volume cap per run

# Discord Webhook Deal & Glitch Alerts
DISCORD_WEBHOOK_URL=               # Discord channel webhook
DISCORD_ENABLED=true               # Enable push alerts
DISCORD_MIN_DEAL_SCORE=75          # Minimum Deal Score for notification
DISCORD_NOTIFY_ATL_ONLY=false      # Set true to notify only on confirmed ATL
DISCORD_NOTIFY_PRICING_ERRORS=true # Glitch Hunter push alerts for pricing errors
```

---

## 3. Local Development

### 3.1 Install Dependencies
```bash
npm install
```

### 3.2 Run in Development Mode
Runs both Fastify backend (with hot reload via `tsx watch`) and Vite client concurrently:
```bash
npm run dev
```

### 3.3 Run Automated Tests
```bash
npm test               # Run all 68 test files (624 tests) with vitest
npm run test:server    # Run server tests only
npm run test:client    # Run client tests only
npm run test:sources   # Run live network adapter connectivity checks
```

### 3.4 Run Typecheck
```bash
npm run typecheck      # tsc --noEmit
```

### 3.5 Build Production Bundle
```bash
npm run build          # Compiles client (Vite) and server (tsc)
```

### 3.6 Run Production Build Locally
```bash
npm start              # node dist/server/index.js
```

---

## 4. Docker Deployment

### 4.1 Running with Docker Compose
```bash
docker compose up -d --build
```
Access the application at `http://localhost:3000`.

Persistent database and cache files will be stored in `./data` on the host mapped to `/data` in the container.

---

## 5. GitHub Actions & GHCR Publishing

The workflow `.github/workflows/docker-publish.yml` triggers on `push` to `main` and on version tags (`v*.*.*`).

1. **Lint & Test**: Runs automated unit and adapter tests (`npm test`).
2. **Build**: Compiles frontend and backend TypeScript.
3. **Container Build**: Uses Docker Buildx with layer caching.
4. **Publish**: Pushes multi-arch images to GitHub Container Registry:
   - `ghcr.io/<owner>/pricesteamtool:latest`
   - `ghcr.io/<owner>/pricesteamtool:<git-sha>`
   - `ghcr.io/<owner>/pricesteamtool:v2.3.0` (on release tag)
