# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

PC gaming enthusiasts, digital collectors, and deal hunters monitoring extensive personal Steam Wishlists (1,000–2,000+ games) on self-hosted personal homelabs or private servers.

## Product Purpose

A personal, cache-first game deal tracker and price intelligence engine that monitors multi-store discounts against a user's Steam Wishlist, accurately computes historical lows, filters pricing errors and glitches, and provides deterministic BUY / FAIR / WAIT guidance.

## Positioning

Unlike public aggregators (IsThereAnyDeal, GG.deals) that require external accounts and lack combined multi-source keyshop scraping with localized solvers in a single self-hosted container, Pricetool runs 100% locally on user hardware with polite source queuing, zero cloud dependencies, transparent Deal Score v2.4 (0–100) mathematics, automatic pricing error quarantine, and instant Discord webhook alerting.

## Operating Context

- **Deployment**: Single-container Docker Compose or local Node.js process backed by a lightweight SQLite database in WAL mode.
- **Surface**: Desktop and mobile web application, accessed on modern browsers.
- **Workflow**: High-density keyboard-driven catalog scanning (`j`/`k`/`Enter`/`Esc`), slide-in flyout intelligence drawer, and push alerts to Discord webhooks.

## Capabilities and Constraints

- **Steam Wishlist Ingestion**: Batch import via public profile URL or Steam64 ID with robust pagination safeguards.
- **Multi-Source Price Aggregation**: Steam Store, IsThereAnyDeal (ITAD), CheapShark, GG.deals, and AllKeyShop (routed through Byparr/FlareSolverr solver).
- **Polite Adaptive Pacing & Circuit Breakers**: Token bucket pacing, exponential jitter, and source-level circuit breakers preventing upstream blocks or IP bans.
- **Pricing Error Engine**: Automatic quarantine for decimal shifts, intra-family retail/keyshop conflicts, and fake discounts with automated self-healing sweeps.
- **Computed Deal Score v2.4 (0–100)**: Transparent 4-pillar scoring factoring proximity to confirmed ATL, discount depth, historical median, and market position.
- **Price Intelligence & Advisor**: Deterministic BUY / FAIR / WAIT recommendations, IQR typical sale price estimation, price volatility metrics, and interactive stepped SVG price history charts.
- **Steam Family Sharing Exclusions**: Automatic detection and 1-click toggling of games excluded from Steam Family Sharing.
- **Currency Intelligence**: Dynamic conversion across EUR, USD, GBP, and HUF using ECB daily exchange rates.

## Brand Commitments

- **Aesthetic**: Developer-grade dark UI inspired by Linear and Raycast with crisp 1px borders, subtle glass surfaces, and semantic color accents (emerald, blue, amber, crimson).
- **Typography**: Monospace (JetBrains Mono) for pricing, currency values, discount percentages, and Deal Scores; clean sans-serif for titles and metadata.
- **Information Density**: High-density compact list view and card grid with zero layout shift and ergonomic slide-in drawer.

## Evidence on Hand

- Production SQLite schema with 22 verified database migrations (`src/server/db/migrations.ts`).
- Full test suite with 84 test suites and 803 unit/integration tests passing cleanly.
- Production dataset and real-world diagnostics logs (`data/Production v1/`).

## Product Principles

1. **User Ownership & Stealth Integrity**: Run strictly on local hardware; pace external API and scraper traffic politely so personal IP addresses are never banned or degraded.
2. **Data Truth & Quarantine**: Never present obvious pricing bugs, decimal shifts, or fraudulent discounts as legitimate All-Time Lows; isolate anomalies safely with self-healing verification.
3. **High-Density Scanability**: Respect the power user's time; provide fast, keyboard-first navigation with rich details in an ergonomic slide-in split panel without losing catalog context.
4. **Transparent, Explainable Mathematics**: Never use opaque "black box" deal ratings; compute every score, typical sale price, and buy recommendation through clear, deterministic statistical models.

## Accessibility & Inclusion

- Full keyboard navigation across wishlist rows and modals (`j`/`k`, `Enter`, `Escape`, `Tab`).
- High-contrast text on dark backgrounds meeting WCAG AA standards.
- Accessible ARIA labels and focus trap handling in flyout and dialog components.
