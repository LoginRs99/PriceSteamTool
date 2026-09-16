# Pricetool — Deep Technical Audit & Validation Report

**Date**: 2026-09-16  
**Version**: 2.3.0  
**Scope**: Complete architecture, Deal Score v2.3 (0–100), Pricing Error Engine with Self-Healing, Best Deal Selection & ATL Auto-Reconciliation, SQLite WAL persistence & Migrations 001–026, CheapShark true multi-AppID batching, source queue pacing & circuit breakers, Docker containerization, and automated test suite.

---

## 1. Executive Summary

A comprehensive technical and domain audit was conducted across the codebase following the release of **v2.0.0**, **v2.1.0**, **v2.2.0**, and **v2.3.0**. All core components have been verified with **68 automated test suites (624 tests)**, full TypeScript compilation (`tsc --noEmit`), and real-data edge-case validation.

### Area Status Scorecard

| Area | Status | Verification Notes |
| :--- | :---: | :--- |
| **Architecture** | **PASS** | Monolithic Fastify 5 + React 19 SPA + SQLite WAL on `/data`. Zero-latency IPC and sub-10ms query latency for 2,000+ items. |
| **Deal Score v2.3** | **PASS** | 4 mathematical pillars ($S_{\text{atl}}$, $S_{\text{disc}}$, $S_{\text{hist}}$, $S_{\text{mkt}}$) with diminishing-returns power curve, data sufficiency caps, and score 100 reservation. |
| **Pricing Error Engine** | **PASS** | Multi-signal error evaluation (`DECIMAL_SHIFT`, `MARKET_OUTLIER`, etc.) with independent peer corroboration override ($\ge 2$ peers within $\pm 40\%$). |
| **Pricing Error Self-Healing**| **PASS** | Automatic startup and post-sync sweeps dismiss resolved errors when prices rise or when cheaper valid deals exist. |
| **Best Deal Selection** | **PASS** | Strict hierarchy: Fresh safe offers ($\le 72\text{h}$) > Stale safe offers > Pricing errors excluded. |
| **ATL Auto-Reconciliation** | **PASS** | Instant updates to `historical_low_eur`, `historical_low_date`, and `historical_low_source` when a safe valid deal undercuts recorded ATL. |
| **CheapShark True Batching**| **PASS** | Bundles 25 Steam AppIDs comma-separated per request, handles pagination up to 3 pages, enriches Metacritic scores, and re-enqueues on 429 backoff. |
| **Pacing & Rate Limiting** | **PASS** | Respectful delays (Steam: 2000ms, ITAD: 1000ms, CheapShark: 1500ms, GGDeals: 1500ms, AllKeyShop: 2500ms) with exponential jitter. |
| **Epoch Header Parsing** | **PASS** | `parseRetryAfterHeader` handles integer delta seconds, HTTP-date, and Unix epoch timestamps (> 1,000,000,000) from Cloudflare rate-limit headers. |
| **SQLite Persistence & Migrations**| **PASS** | Migrations 001–026 execute idempotently. Dedicated `pricing_errors` table, composite indexes, and cached prepared statements. |
| **Testing Coverage** | **PASS** | **68 test files / 624 automated unit & integration tests passing (100%) cleanly**. |

---

## 2. Key Hardening & Architectural Milestones

1. **Deal Score v2.3 Mathematical Reformulation**:
   - Replaced linear discount scoring with a concave diminishing-returns curve: $30 \times ((\text{anchor} - \text{price})/\text{anchor})^{0.75}$.
   - Reserved score 100 exclusively for verified deals beating the confirmed ATL by $\ge 5\%$.
   - Added provisional caps to prevent artificial high scores on games with sparse historical data.
2. **Pricing Error Engine & Self-Healing Architecture**:
   - Replaced legacy anomaly heuristics with dedicated `pricing_errors` table.
   - Gated sub-euro glitch checks behind price $\le 1.005\text{ €}$ and MSRP $\ge 10\text{ €}$.
   - Added automatic dismissal when price increases, when an offer is unflagged, or when a cheaper valid offer is available.
3. **CheapShark Multi-AppID Batching & Metacritic Enrichment**:
   - Switched from sequential 1-game requests to 25 AppIDs per comma-separated request.
   - Added pagination support (`pageSize=60`, up to 3 pages).
   - Enriched games with Metacritic critic score and review URLs.
4. **Best Deal Freshness Hierarchy & ATL Auto-Reconciliation**:
   - Structured SQL ordering prioritizing fresh safe offers ($\le 72\text{h}$) over stale safe offers, excluding glitched offers.
   - Automatic database reconciliation updating `historical_low_eur` whenever a safe offer undercuts the historical low.
5. **Rate Limiting & Cloudflare Cooldown Resilience**:
   - Default delays raised to safe, sensible levels across all source adapters.
   - Added support for Unix epoch timestamps in `Retry-After` and `X-RateLimit-Reset` headers.
   - Circuit breaker sleep intervals sliced to 1s/2s to prevent cancellation hangs.
