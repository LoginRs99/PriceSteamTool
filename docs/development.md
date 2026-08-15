# Development & Deployment Guide

This guide covers local environment setup, testing, Docker orchestration, and the CI/CD pipeline.

---

## 1. Project Directory Structure

```text
Pricetool/
├── .github/
│   └── workflows/
│       └── docker-publish.yml     # GitHub Actions CI/CD to GHCR
├── docs/                          # Architectural & source specifications
│   ├── architecture.md
│   ├── sources.md
│   ├── data-model.md
│   ├── sync.md
│   └── development.md
├── src/
│   ├── server/                    # Fastify backend & sync engine
│   │   ├── config/                # Environment variables & constants
│   │   ├── db/                    # SQLite database & migrations (Drizzle/better-sqlite3)
│   │   ├── domain/                # Domain models, normalizers, deduplication, anomaly scoring
│   │   ├── sources/               # Source adapters (ITAD, GGDeals, CheapShark, Steam, AllKeyShop)
│   │   ├── sync/                  # Job queue, rate limiters, circuit breakers, orchestrator
│   │   ├── routes/                # REST API routes & SSE stream (/api/*)
│   │   └── index.ts               # Server entry point
│   ├── client/                    # Modern React SPA (Vite)
│   │   ├── src/
│   │   │   ├── components/        # UI components (GameCard, OfferList, SyncStatus, Filters)
│   │   │   ├── hooks/             # Custom hooks (useWishlist, useSyncProgress, useFilters)
│   │   │   ├── types/             # Frontend shared domain types
│   │   │   ├── App.tsx            # Main application
│   │   │   └── index.css          # Design system CSS tokens & styles
│   │   ├── index.html
│   │   └── vite.config.ts
│   └── shared/                    # Shared types & schemas
├── tests/                         # Unit, integration, & adapter fixture tests
│   ├── unit/
│   ├── adapters/
│   └── e2e/
├── Dockerfile                     # Multi-stage production container
├── docker-compose.yml             # Local production compose
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

# Pacing & Safety Overrides (Milliseconds)
ITAD_DELAY_MS=1000
GGDEALS_DELAY_MS=1500
CHEAPSHARK_DELAY_MS=1000
ALLKEYSHOP_DELAY_MS=4000
```

---

## 3. Local Development

### 3.1 Install Dependencies
```bash
npm install
```

### 3.2 Run in Development Mode
Runs both Fastify backend (with hot reload) and Vite client:
```bash
npm run dev
```

### 3.3 Run Tests
```bash
npm test
```

### 3.4 Build Production Bundle
```bash
npm run build
```

---

## 4. Docker Deployment

### 4.1 Running with Docker Compose
```bash
docker compose up -d --build
```
Access the application at `http://localhost:3000`.

Persistent database and cache files will be stored in the `./data` directory on the host mapped to `/data` in the container.

---

## 5. GitHub Actions & GHCR Publishing

The workflow `.github/workflows/docker-publish.yml` triggers on `push` to `main` and on version tags (`v*.*.*`).

1. **Lint & Test**: Runs automated unit and adapter tests.
2. **Build**: Compiles frontend and backend TypeScript.
3. **Container Build**: Uses Docker Buildx with layer caching.
4. **Publish**: Pushes multi-arch images to GitHub Container Registry:
   - `ghcr.io/<owner>/pricetool:latest`
   - `ghcr.io/<owner>/pricetool:<git-sha>`
   - `ghcr.io/<owner>/pricetool:v1.0.0` (on release tag)
