# System Architecture

This document describes the design, component interactions, security posture, and technical choices for **Pricetool** (v2.10.2).

---

## 1. System Overview

The system is a self-hosted, cache-first game price tracking and aggregation service designed specifically to track large Steam Wishlists (2,000+ games) reliably without aggressive scraping or IP bans.

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   Frontend (React 19 SPA)                              │
│  - Linear / Raycast Dark Aesthetic (JetBrains Mono numbers, crisp 1px borders, blur)   │
│  - Hybrid Split-View / Slide-in Details Panel (Keyboard j/k/Enter/Esc + touch sheet)   │
│  - Live Multi-Currency Engine (EUR, USD, GBP, CAD, AUD, and native HUF Ft formatting)  │
│  - Realized Savings Tracker & Purchase Journal (Megtakarítás-követő)                   │
│  - Real-time Sync Progress Monitor (Server-Sent Events: /api/sync/events)               │
│  - Source Adapters Diagnostics & Self-Healing (1-click Reset / Unpause button)         │
│  - Game Detail View (All Offers, Price History, Interactive SVG Chart, Review Badges)  │
│  - Steam Family Sharing Exclusions & 1-Click Storefront Category 62 Validation         │
│  - Grouped Data Safety Review View (/api/anomalies) with User Feedback & CSV Export    │
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
│  │  - Pricing Error Engine (8 Error Types, Peer Corroboration, Self-Healing)         │ │
│  │  - Deal Score v2.4 Engine (4 Pillars, Diminishing-Returns Curve, Sigmoid Ramps)   │ │
│  │  - Dual ATLs & Auto-Reconciliation (Official Store vs All-Store low tracking)    │ │
│  │  - Fresh Drops Radar (1–7 Days, micro-drop noise filtering, relative badges)      │ │
│  │  - Sale Cadence & Subscription Radar (RARE_SALE detection, Game Pass & EA Play)   │ │
│  │  - Price Intelligence Advisor (Period Lows, IQR Typical Sale, Volatility CV)      │ │
│  │  - Realized Savings Calculator (Snapshots vs MSRP & typical median)               │ │
│  │  - Automated Zero-Downtime Backup Engine (Online snapshot, quick_check, 7d prune) │ │
│  └────────────────────────────────────────┬──────────────────────────────────────────┘ │
│                                           │                                            │
│  ┌────────────────────────────────────────▼──────────────────────────────────────────┐ │
│  │                             Source Adapter Framework                              │ │
│  │  ┌───────────────┐ ┌───────────────┐ ┌─────────────────┐ ┌──────────────────────┐ │ │
│  │  │ Steam Store   │ │ ITAD Batch    │ │ CheapShark      │ │ GG.deals & Keyshops  │ │ │
│  │  │ (2000ms pace) │ │ (1000ms pace) │ │ Multi-AppID 25x │ │ (1500ms pace)        │ │ │
│  │  │ (MSRP/Review) │ │ (200 IDs/req) │ │ (1500ms pace)   │ │ NEXARDA & SDB       │ │ │
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
│  │  16 Tables, Migrations 001–038, Automated Backups (/data/backups/)                 │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Key Architectural Decisions

### 2.1 Single-Process Architecture with Decoupled Queues
* **Decision**: Single unified TypeScript runtime (Node.js 22 LTS) executing the Fastify backend, background task orchestrator, and serving the pre-compiled React SPA.
* **Rationale**: Eliminates multi-container microservice complexity for a personal self-hosted application. Delivers zero-latency IPC, shared in-memory rate-limiter tokens, real-time SSE broadcasts, and rock-solid SQLite transactional safety in WAL mode.

### 2.2 Domain-Level Offer Deduplication & Provenance
* **Decision**: Strict separation between `Merchant`, `Offer`, and `SourceObservation`.
* **Rationale**: When multiple adapters (e.g. ITAD and CheapShark) observe the same merchant (e.g. Fanatical at €14.99), it is stored as **one canonical Offer** for Fanatical, supported by **two SourceObservations**. If prices diverge slightly due to FX rounding or crawl timing, both observations are preserved, with stored `fx_rate` and `fx_rate_timestamp`, and the freshest/most valid observation updates the canonical offer price.

### 2.3 Strict Pacing, Jitter & Circuit Breaker Engine
* **Decision**: Every adapter operates via an isolated `PacedSourceQueue` with token-bucket interval, exponential-tailed jitter, and a 4-state Circuit Breaker (`NORMAL` → `BACKOFF` → `PAUSED` → `COOLDOWN` → `NORMAL`).
* **Safe Defaults**:
  - Steam Storefront: 2000 ms delay, 250 ms jitter.
  - ITAD: 1000 ms delay, 200 ms jitter.
  - CheapShark: 1500 ms delay, 250 ms jitter.
  - GG.deals: 1500 ms delay, 300 ms jitter.
  - NEXARDA: 500 ms delay, 100 ms jitter.
  - SuperDuperBundle: 1000 ms delay, 200 ms jitter (50 games/chunk).
* **Rationale**: Guarantees total failure isolation. If an unauthenticated source encounters a Cloudflare challenge or 429, it enters `BACKOFF` or `PAUSED` without blocking ITAD or CheapShark throughput.

### 2.4 CheapShark Multi-AppID Batching Architecture
* **Decision**: Bundle **25 Steam App IDs per comma-separated request** (`/api/1.0/deals?steamAppID=id1,id2,...&pageSize=60`) with pagination up to 3 pages, Metacritic review/score enrichment, and 429 re-enqueue handling.
* **Rationale**: Replaced legacy per-game requests with true multi-ID batching supported by CheapShark's public API. Reduced HTTP traffic by >90% (from 150 requests down to 6 requests for 150 games), completely preventing Cloudflare 429 rate-limit tripping while enriching games with Metacritic metadata.

### 2.5 Best Deal Selection, Dual ATLs & Official Store Priority
* **Decision**: Canonical ranking hierarchy enforced across SQLite queries:
  $$\text{Fresh Safe Offers } (\le 72\text{h}) > \text{Stale Safe Offers} > \text{Pricing Errors (Excluded)}$$
  Within each freshness tier, offers sort by `price_eur ASC`, followed by **official store priority** (`m.is_official DESC`), and finally recency (`last_observed_at DESC`).
* **Official Store Tie-Breaker**: When an authorized official storefront and a marketplace keyshop offer the exact same lowest price, the official store is preferentially crowned as the winning Best Deal.
* **Dual All-Time Lows (Official Store ATL vs All-Store ATL)**: Tracks `official_historical_low_eur` (publisher-authorized storefront record low) alongside `historical_low_eur` (market-wide low) to serve users who prefer verified store purchases.
* **ATL Quarantine**: Single-source unconfirmed new ATL offers from non-official sources are quarantined from immediately overwriting `games.historical_low_eur` and corrupting typical sale medians until corroborated or confirmed by official stores.
* **Auto-Reconciliation**: When `recomputeBestDealForGame` or `BEST_DEAL_RECOMPUTE_ALL_SQL` evaluates a safe valid offer whose price is strictly lower than `game.historical_low_eur`, it immediately reconciles `historical_low_eur`, `historical_low_date`, and `historical_low_source`. Startup database sweeps automatically heal any catalog-wide discrepancies.

### 2.6 Dedicated Pricing Error Architecture with Self-Healing
* **Decision**: Complete isolation of glitched prices into a dedicated `pricing_errors` table and `is_likely_pricing_error` flag on `offers`, backed by independent peer corroboration and automatic self-healing.
* **Rationale**: Glitches never distort Deal Scores, historical lows, or best deal badges. When prices return to normal or cheaper valid offers appear, errors auto-dismiss without manual operator intervention.
* **Official Store Exemption & Keyshop Glitch Catching Policy**:
  * Authorized official storefronts (Steam, Humble Store, GreenManGaming, Fanatical, GOG, WinGameStore) are exempt from `MARKET_OUTLIER` and `FAKE_BASELINE` anomaly flags because publisher-authorized promotions represent authentic transactions, not marketplace glitches.
  * Keyshop anomalies remain calibrated for sensitivity rather than over-hardened suppression. This allows users to catch and exploit genuine retailer pricing glitches while filtering obvious noise.
  * Post-sync sweeps (`purgeCorruptedPricingErrors`) automatically resolve false positives on offers that are corroborated or at/above confirmed historical lows.

### 2.7 Zero-Downtime SQLite Backup & Disaster Recovery Architecture
* **Decision**: Online non-blocking SQLite backup leveraging `better-sqlite3` native backup API (`db.backup()`) with `PRAGMA wal_checkpoint(PASSIVE)`.
* **Verification & Retention**: Immediately after backup creation, `PRAGMA quick_check` verifies archive integrity. Rolling 7-day retention prunes obsolete backups automatically in `/data/backups/`.
* **Rationale**: Prevents database corruption from naive file copying during active concurrent transactions, ensuring instantaneous zero-downtime backups in <50ms.

### 2.8 Purchase Journal & Realized Savings Tracking Engine
* **Decision**: Snapshot-based purchase accounting in `purchases` table.
* **Rationale**: When the user buys a game ("Megvettem" button), the system records the exact purchase price alongside the game's official MSRP and typical sale median at that specific moment. This allows the `SavingsView` to compute true historical savings versus both full retail price and standard recurring sales.

---

## 3. Security & Reliability Posture

1. **Non-Root Container Execution**: The Docker container executes as the non-privileged `node` user (UID/GID 1000:1000) with explicit ownership of the `/data` persistent volume.
2. **SSRF & Webhook Protection**: Outbound webhook requests are strictly validated against a Discord domain allowlist (`discord.com`, `discordapp.com`, `ptb.discord.com`, `canary.discord.com`), blocking internal IP and loopback requests.
3. **Prepared Statement Caching**: All SQLite database queries use parameterized prepared statements managed by an in-memory statement cache (`prepareStmt`), preventing SQL injection and memory leaks under 2,000+ game workloads.
4. **XSS Protection**: Zero use of `dangerouslySetInnerHTML` in React 19 SPA. All user and game strings are escaped natively by JSX.
5. **Anti-Rate-Limit v1 API**: High-volume third-party integrations use `/api/v1/offers/batch` with ETag caching (`304 Not Modified`) and IETF rate-limit headers to prevent local server exhaustion.
6. **Graceful Shutdown**: Traps `SIGTERM` and `SIGINT` to gracefully drain active queues, finalize ongoing SQLite transactions, execute WAL checkpointing, and terminate Fastify listener.
7. **Centralized Secret Sanitization**: Redacts sensitive API tokens, passwords, session secrets, and Discord webhook URLs across all logging pipelines, error handlers, and SSE telemetry via `sanitizeSecrets()`, preventing credential leakage.
