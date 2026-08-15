# System Architecture

This document describes the design, component interactions, security posture, and technical choices for the Steam Wishlist Price Aggregator.

---

## 1. System Overview

The system is a self-hosted, cache-first game price tracking and aggregation service designed specifically to track large Steam Wishlists (2000+ games) reliably without aggressive scraping or IP bans.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          Frontend (SPA)                                │
│  - Dark modern gamer UI (Virtual scroll, instant search, filters)       │
│  - Real-time Sync Progress Monitor (Server-Sent Events)                │
│  - Game Detail View (All Offers, Price History, Anomaly indicators)    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP REST & SSE
┌───────────────────────────────────▼────────────────────────────────────┐
│                       Backend Core (Node.js/TS)                         │
│  ┌─────────────────────────┐      ┌──────────────────────────────────┐ │
│  │    REST API Endpoints   │      │     Wishlist & Sync Manager      │ │
│  │   /api/profiles, /games │      │  - Steam Wishlist Ingestion      │ │
│  │   /api/sync, /api/status│      │  - Priority Multi-Source Queues  │ │
│  └────────────┬────────────┘      └────────────────┬─────────────────┘ │
│               │                                    │                   │
│  ┌────────────▼────────────────────────────────────▼─────────────────┐ │
│  │                     Domain Engine & Services                      │ │
│  │  - Normalizer & Region Filter (EU/HU/Global verification)         │ │
│  │  - Offer Deduplicator & Observation Tracker                       │ │
│  │  - Price Anomaly Detection Engine (Scoring / Price Errors)        │ │
│  │  - Historical Low Evaluator & Provenance Tracker                  │ │
│  └────────────────────────────┬──────────────────────────────────────┘ │
│                               │                                        │
│  ┌────────────────────────────▼──────────────────────────────────────┐ │
│  │                  Source Adapter Framework                         │ │
│  │  ┌───────────────┐ ┌──────────────┐ ┌───────────────────────────┐ │ │
│  │  │ ITAD Adapter  │ │GG.deals Adpt │ │CheapShark / Fallbacks     │ │ │
│  │  │ (Batch v2/v3) │ │ (API/Direct) │ │(Public REST / Resilient)  │ │ │
│  │  └───────┬───────┘ └──────┬───────┘ └─────────────┬─────────────┘ │ │
│  │          │ Rate Limiter   │ Circuit Breaker       │ Exponential   │ │
│  │          │ (Token Bucket) │ (State Engine)        │ Backoff       │ │
│  └──────────┴────────────────┴───────────────────────┴───────────────┘ │
│                               │                                        │
│  ┌────────────────────────────▼──────────────────────────────────────┐ │
│  │                Persistent Store (SQLite in WAL mode)              │ │
│  │  /data/database.sqlite (Games, Offers, History, Observations)     │ │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Key Architectural Decisions

### 2.1 Single-Process Architecture with Decoupled Queues
* **Decision**: Single unified TypeScript runtime (Node.js 22 LTS) running Fastify backend + background task orchestrator + serving the compiled modern React SPA.
* **Rationale**: Avoids bloated multi-container microservice complexity for a personal self-hosted tool. Provides zero latency IPC, shared in-memory rate-limiter tokens, instant SSE broadcasts, and rock-solid SQLite transactional safety with WAL mode.

### 2.2 Domain-Level Offer Deduplication & Provenance
* **Decision**: Distinguish between `Merchant`, `Offer`, and `SourceObservation`.
* **Rationale**: If both ITAD and GG.deals report Fanatical at €14.99, it is stored as **one canonical Offer** for Fanatical, reinforced by **two SourceObservations**. If prices differ slightly (e.g. currency rounding or scrape delay), both observations are kept, and the freshest/highest confidence observation drives the active offer price.

### 2.3 Strict Pacing & Circuit Breaker Engine
* **Decision**: Every adapter has an isolated token-bucket rate limiter and a 4-state Circuit Breaker (`NORMAL` → `BACKOFF` → `PAUSED` → `COOLDOWN` → `NORMAL`).
* **Rationale**: Completely isolates failures. If an unauthenticated fallback source hits a 429 or Cloudflare challenge, it immediately transitions to `PAUSED` without blocking ITAD or CheapShark.

### 2.4 Cache-First & Incremental Refresh
* **Decision**: Persistent cache with configurable TTL (default: 6 hours for active deals, 24 hours for stable catalogs).
* **Rationale**: 2000 games do not need continuous refreshing. High-batch endpoints (like ITAD) refresh up to 200 games per request in seconds, while single-request sources only poll out-of-date entries.

---

## 3. Security & Reliability

1. **Non-Root Execution**: Docker container runs as non-privileged `node` user with explicit UID/GID ownership on `/data`.
2. **SSRF & URL Sanitization**: All merchant redirect links and external requests are validated against known domains; no user-supplied arbitrary URL fetching.
3. **HTML & Data Sanitization**: All external payloads (titles, merchant names, raw notes) are strictly stripped of dangerous HTML tags before storage or UI rendering.
4. **Graceful Shutdown**: Handles `SIGTERM` / `SIGINT` by stopping active queues, flushing SQLite WAL checkpoints, and closing client connections cleanly.
