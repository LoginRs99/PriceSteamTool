# 🎮 PriceSteamTool — Project Summary & Architecture Guide

> **Quick Summary for New Sessions & Developers**  
> Complete technical reference and handover documentation is available at [`docs/SESSION_HANDOVER.md`](file:///D:/github/Pricetool/docs/SESSION_HANDOVER.md).

---

## 📌 TL;DR Overview (v1.6.0)

PriceSteamTool is an open-source, privacy-first, self-hosted Steam Wishlist Price Aggregator and Deal Intelligence platform built on:
- **Backend:** Node.js 22+, Fastify 5, TypeScript, Better-SQLite3 (WAL mode, prepared statement caching, composite indexing).
- **Frontend:** React 19, TypeScript, Vite, Vanilla CSS (Tailwind-free custom design system).
- **APIs:** Legacy SPA routes (`/api/*`) + New Anti-Rate-Limit REST API (`/api/v1/*`) with `POST /api/v1/offers/batch`, `POST /api/v1/games/resolve`, ETag `304` caching, and IETF rate limit headers.
- **Sources:** Steam Storefront, IsThereAnyDeal (ITAD v2), CheapShark Batch, GG.deals, AllKeyShop.
- **Engines:**
  - **Deal Score v2:** Monotonic 0–100 mathematical scoring with Z-Score + IQR effective sigma and sigmoid mapping.
  - **Data Confidence:** 0–100% confidence rating based on sample size, history timespan, and multi-source consensus.
  - **Anomaly & Risk Engine:** Multi-factor pricing glitch detection with peer corroboration (`SUB_EURO_PREMIUM_GLITCH_CORROBORATED`, `LONE_BOTTOM_OUTLIER`).
  - **Action Signal Engine:** `BUY_NOW`, `STRONG_BUY`, `FAIR_DEAL`, `WAIT`, `MONITOR`.
  - **Adaptive Keyshop Pacing:** Self-tuning exponential backoff (24h -> 168h ceiling) on stable prices with active target price override, 7s delay / 4s jitter, User-Agent rotation, and selective Client Hints.
  - **Discord Webhook Alerts:** Multi-tier deal notifications with provisional filtering, target price hit alerts, and post-enrichment keyshop deal dispatch.

---

## 🚀 Key Commands

```bash
npm run typecheck   # Typecheck (tsc --noEmit)
npm test            # Run all 20 Vitest suites (200 tests)
npm run build       # Build client (Vite) and server (TypeScript)
npm start           # Run production server
```

For full documentation of algorithms, data models, and recent changelog, see [docs/SESSION_HANDOVER.md](file:///D:/github/Pricetool/docs/SESSION_HANDOVER.md).
