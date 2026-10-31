# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
PC gaming enthusiasts, digital collectors and deal hunters monitoring extensive Steam Wishlists (1,000–2,000+ games) on self-hosted personal homelabs or private servers.

## Product Purpose
A personal, cache-first game deal tracker and price intelligence engine that monitors multi-store discounts against a user's Steam Wishlist, accurately computes historical lows, filters pricing errors and glitches, and provides deterministic BUY / FAIR / WAIT guidance.

## Positioning
A self-hosted alternative combining multi-source storefront data, localized keyshop scraping/solver support, transparent deal intelligence and local data ownership.

## Operating Context
- Deployment: single-container Docker Compose or local Node.js process with SQLite WAL.
- Surface: desktop and mobile web application.
- Workflow: catalog scanning, price intelligence, wishlist tracking and Discord webhook alerts.

## Capabilities and Constraints
- Steam Wishlist ingestion with pagination safeguards.
- Steam Store, IsThereAnyDeal, CheapShark, GG.deals and AllKeyShop integrations.
- Polite adaptive pacing, retries and source-level circuit breakers.
- Pricing-error quarantine and verification.
- Transparent Deal Score and BUY / FAIR / WAIT recommendations.
- Historical price intelligence and currency conversion.
- Steam Family Sharing exclusions and Discord notifications.

## Product Principles
1. User ownership and polite upstream traffic.
2. Data truth: quarantine suspicious pricing rather than presenting it as a legitimate low.
3. High-density scanability and keyboard accessibility.
4. Explainable deterministic pricing and recommendation logic.

## Evidence and source of truth
- Runtime behavior and architecture: current source under `src/`.
- Database evolution: `src/server/db/migrations.ts` and migration tests.
- Verification commands: `package.json` and `.github/workflows/docker-publish.yml`.
- Historical datasets and validation notes are date-bound evidence, not guarantees about the current revision. Re-run current checks before relying on a result.
