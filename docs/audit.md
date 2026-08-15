# Pricetool — Deep Technical Audit & Validation Report

**Date**: 2026-08-15  
**Version**: 1.3.0  
**Scope**: Complete architecture, 2D Pricing Engine, Deal Score (0–100), Price Intelligence (BUY/FAIR/WAIT), SQLite WAL persistence, multi-source queue orchestrator, Docker containerization, and automated test suite.

---

## 1. Executive Summary

A comprehensive technical and domain audit was conducted across **v1.0**, **v1.1**, **v1.2**, and **v1.3**. All core components have been verified with 106 automated tests, typecheck analysis, and real-data edge-case validation.

### Area Status Scorecard

| Area | Status | Verification Notes |
| :--- | :---: | :--- |
| **Architecture** | **PASS** | Monolithic Fastify + Vite SPA + SQLite WAL on `/data`. Sub-50ms query latency for 2000+ items. |
| **Steam Integration** | **PASS** | Paginated batch metadata ingestion via `wishlistdata` with rate-limited fallback. |
| **Currency & Exchange Rates** | **PASS** | Raw currencies (`USD`, `GBP`, `HUF`) preserved alongside normalized EUR prices via daily cached ECB rates. |
| **Canonical Deduplication** | **PASS** | Deduplicated store offers backed by multi-source `source_observations` provenance. |
| **2D Pricing Engine** | **PASS** | Decoupled magnitude (`PriceEventType`) and risk (`PriceRiskLevel`). Multi-source consensus dampening. |
| **Computed Deal Score** | **PASS** | 4-Pillar scoring (Discount, Historical, Trust, Risk/Confidence) with 35-pt high-risk cap. |
| **Price Intelligence Engine** | **PASS** | 7d/30d/90d/1y period lows with nullable fallbacks, Tukey's IQR outlier filtering for typical sales, and daily CV volatility. |
| **BUY / FAIR / WAIT Advisor** | **PASS** | Deterministic precedence avoiding false BUY or false FAIR on weak discounts. |
| **SVG Price History Chart** | **PASS** | Lightweight (< 5KB) pure SVG with stepped timeline, MSRP baseline, ATL line, and Typical Sale band. |
| **SQLite Persistence** | **PASS** | WAL mode, foreign keys, optimized compound indexes, and clean statement lifecycle. |
| **Docker Packaging** | **PASS** | Alpine Linux non-root `node` user with healthcheck and persistent volume mounting. |
| **Testing Coverage** | **PASS** | **106 / 106 automated unit & integration tests passing (100%) in < 2.0s**. |

---

## 2. Key Audit Hardening & Fixes Applied

1. **Idempotent Price History Tracking**: Prevents database bloating by only recording changes when price or discount changes by $\ge 0.005\text{ €}$.
2. **Nullable Period Lows**: Eliminates false period low claims by returning `null` when a game has insufficient historical span (e.g. 3-day history).
3. **Statistical IQR Outlier Fences**: Replaced rigid cutoff filters with Tukey's IQR Fences to reject glitch observations while preserving legitimate 85–90% publisher sales.
4. **Volatilitiy on Observed Days**: Missing sync days do not produce synthetic jumps; volatility is computed strictly across observed calendar days.
5. **False FAIR Prevention in Advisor**: Required that 90-day low matches must also represent a real sale ($\ge 25\%$ off) and not exceed typical sale price.
6. **SQLite Statement Lifecycle in Tests**: Ensured clean prepared statement clearing and database handle shutdown on test suite completion.
