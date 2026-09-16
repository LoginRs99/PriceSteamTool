# Synchronization & Rate Limiting Engine

This document details the synchronization workflow, queue orchestrator, circuit breaker state machine, data normalization pipeline, and pricing error detection engine for **Pricetool** (v2.3.0).

---

## 1. Synchronization Flow

```text
               User clicks "Sync Wishlist" (or Cron Trigger)
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │    Steam Wishlist Ingestion   │
                    │   (IWishlistService / HTML)   │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   Catalog & AppID Resolution  │
                    │  (Batch ITAD lookup & Details)│
                    └───────────────┬───────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│    ITAD Queue    │        │ CheapShark Queue │        │  GG.deals Queue  │
│  - 200 items/req │        │  - 25 AppIDs/req │        │  - 1 req / 1.5s  │
│  - 1 req / 1.0s  │        │  - 1 req / 1.5s  │        │  - Jitter: 300ms │
│  - Jitter: 200ms │        │  - Jitter: 250ms │        │                  │
└─────────┬────────┘        └─────────┬────────┘        └─────────┬────────┘
          │                           │                           │
          └───────────────────────────┼───────────────────────────┘
                                      │
                                      ▼
                    ┌───────────────────────────────────┐
                    │   AllKeyShop Queue (Secondary)    │
                    │   - Solver Required (Byparr)      │
                    │   - Adaptive Check (24h - 168h)   │
                    │   - Pacing: 2.5s + Jitter: 500ms  │
                    └─────────────────┬─────────────────┘
                                      │
                                      ▼
                    ┌───────────────────────────────────┐
                    │     Normalization & Filtering     │
                    │   - Product: Steam Key / Gift     │
                    │   - Region: EU / HU / Global      │
                    │   - Exclude: Accounts / Non-Steam │
                    └─────────────────┬─────────────────┘
                                      │
                                      ▼
                    ┌───────────────────────────────────┐
                    │    Deduplication & Provenance     │
                    │   - Canonical Offer matching      │
                    │   - Multi-source observations     │
                    └─────────────────┬─────────────────┘
                                      │
                                      ▼
                    ┌───────────────────────────────────┐
                    │    Pricing Error Detection &      │
                    │       Peer Corroboration          │
                    └─────────────────┬─────────────────┘
                                      │
                                      ▼
                    ┌───────────────────────────────────┐
                    │    Best Deal Selection & ATL      │
                    │       Auto-Reconciliation         │
                    └─────────────────┬─────────────────┘
                                      │
                                      ▼
                    ┌───────────────────────────────────┐
                    │    Database Write & SSE Event     │
                    │  (Real-time progress broadcast)   │
                    └───────────────────────────────────┘
```

---

## 2. Source Queue Pacing & Token Bucket

Every adapter executes inside an isolated `PacedSourceQueue` with token-bucket interval, exponential-tailed jitter, and circuit breaker protection:

1. **Steam Storefront Worker (Batch API)**:
   * Chunks wishlist entries into 200 items per request.
   * `STEAM_DELAY_MS=2000` (jitter: 250ms). Page delay floor enforced at 2000ms.
   * Ingests baseline MSRP, Steam Store discounts, and review scores.

2. **ITAD Batch Worker (Batch API)**:
   * Chunks out-of-date games into batches of 150–200 IDs.
   * `ITAD_DELAY_MS=1000` (jitter: 200ms).
   * Total requests for 2,000+ games: **~10–14 requests (~15 seconds total)**.

3. **CheapShark Batch Worker (Batch API)**:
   * Bundles **25 Steam App IDs per comma-separated request** (`/api/1.0/deals?steamAppID=id1,id2,...&pageSize=60`).
   * Supports pagination (`pageSize=60`, up to 3 pages) when 60 deals are returned.
   * Enriches Metacritic scores and review URLs.
   * `CHEAPSHARK_DELAY_MS=1500` (jitter: 250ms).
   * Total requests for 2,000+ games: **~80 requests (~2 minutes total)**.

4. **GG.deals Worker (Batch / Selective API)**:
   * `GGDEALS_DELAY_MS=1500` (jitter: 300ms). Refreshes batch catalog in parallel.

5. **AllKeyShop Worker (Adaptive Keyshop Enrichment)**:
   * Strictly routed through an anti-bot solver (Byparr / FlareSolverr).
   * `ALLKEYSHOP_DELAY_MS=2500` (jitter: 500ms) with exponential-tailed jitter.
   * Adaptive intervals (24h to 168h ceiling) based on price stability streak.

---

## 3. Circuit Breaker State Machine

```text
    ┌──────────┐
    │  NORMAL  │◄───────────────────────────┐
    └────┬─────┘                            │
         │ (3x 429 or network fails)        │ (Probe success)
         ▼                                  │
    ┌──────────┐                            │
    │ BACKOFF  │ (30s delay)                │
    └────┬─────┘                            │
         │ (Subsequent failure)             │
         ▼                                  │
    ┌──────────┐                            │
    │  PAUSED  │ (15m - 30m cooldown)       │
    └────┬─────┘                            │
         │ (Cooldown timer expires)         │
         ▼                                  │
    ┌──────────┐                            │
    │ COOLDOWN ├────────────────────────────┘
    └────┬─────┘ (Single probe request)
         │ (Probe failure)
         ▼
    (Return to PAUSED with doubled cooldown)
```

### Circuit Breaker States:
* **NORMAL**: Full operation, requests dispatched at configured interval + jitter.
* **BACKOFF**: Source encountered transient error (e.g. 429 or timeout); paused for 30 seconds before retrying job.
* **PAUSED**: Repeated failures exceeded threshold. Source queue paused for 15–30 minutes. Other source queues continue unimpeded.
* **COOLDOWN**: Source cooldown timer expired; dispatches a single test probe. If successful, state resets to `NORMAL`.

---

## 4. Normalization Rules

### 4.1 Product Type Verification
* **Allowed**:
  * `STEAM_KEY`: Digital key redeemable directly on Steam.
  * `STEAM_GIFT`: Gift inventory item delivered to Steam account.
  * `DIRECT_PURCHASE`: Official store purchase connecting to Steam (e.g. Steam Store, Humble Store direct entitlement).
* **Strictly Blocked / Discarded**:
  * Any item labeled `Account`, `Shared Account`, `Steam Account`, `Offline Activation`, `Family Share`, or `Account Transfer`.

### 4.2 Region Verification & Confidence
* **Target Audience**: Hungary / European Union / Global.
* **Allowed**:
  * `GLOBAL` / `Worldwide` / `Region Free` (Confidence: 1.0)
  * `EU` / `Europe` / `EEA` (Confidence: 1.0)
  * `HU` (Hungary specific) (Confidence: 1.0)
* **Blocked**:
  * Country-locked to non-EU regions: `US`, `CA`, `RU`, `TR`, `AR`, `BR`, `CN`, `LATAM`, `Asia-only`.
  * If region is ambiguous or unknown, marked as `RESTRICTED` with `is_valid = 0`.

---

## 5. Pricing Error Engine & Self-Healing

Pricing error evaluation is managed by `src/server/domain/pricingError/detector.ts`:

### 5.1 Triggered Signals
1. **`DECIMAL_SHIFT` (Weight: 0.45):**
   * Sub-euro glitch: Price $\le 1.005\text{ €}$ on games with MSRP $\ge 10\text{ €}$ (or MSRP $\ge 5\text{ €}$ with price $< 0.05 \times \text{MSRP}$).
   * Missing digit shift: Price is $\sim 1/10$ ($0.08\text{--}0.12$) or $\sim 1/100$ ($0.008\text{--}0.012$) of MSRP on titles with MSRP $\ge 30\text{ €}$ when all peers are near full price ($\ge 0.60 \times \text{MSRP}$).
   * Extreme drop: Price ratio $\le 0.03$ on titles with MSRP $\ge 15\text{ €}$.
2. **`MARKET_OUTLIER` (Weight: 0.25–0.40):**
   * Lone outlier $> 50\%$ below a single peer, or $> 75\%$ below multi-peer median (unless price matches or beats confirmed ATL).
3. **`BELOW_ATL_IMPLAUSIBLE` (Weight: 0.35):**
   * Price is $> 50\%$ below confirmed All-Time Low on established games.
4. **`OWN_HISTORY_BREAK` (Weight: 0.30):**
   * Merchant's own price history shows a sudden collapse ($z > 2.5$) vs historical median.
5. **`FRESH_RELEASE_DROP` (Weight: 0.35):**
   * Discount $> 40\%$ on games released $< 30$ days ago without official publisher confirmation.
6. **`EDITION_INVERSION` (Weight: 0.30):**
   * Deluxe/Gold/Complete edition priced $> 30\%$ below base game.
7. **`FAKE_DISCOUNT` (Weight: 0.20):**
   * Claimed original price $> 1.5\times$ base Steam MSRP.

### 5.2 Independent Peer Corroboration Override
If an offer triggers `DECIMAL_SHIFT` or other outlier signals, but $\ge 2$ independent fresh peer prices match within $\pm 40\%$, the error flag is overridden:
* `errorEval.isLikelyPricingError` is set to `false`.
* The flag is recorded as `SUB_EURO_PREMIUM_GLITCH_CORROBORATED`.
* The offer remains active as a legitimate flash promotion.

### 5.3 Automated Self-Healing & Dismissal
* **On Server Startup:** Queries `pricing_errors` and auto-dismisses errors where the offer is now a `PRICE_INCREASE`, where `is_likely_pricing_error = 0`, where `is_valid = 0`, or where a peer offer has a cheaper valid price.
* **Post-Sync Sweeps:** Unflagged offers have `is_likely_pricing_error = 0` and are restored to best deal consideration.

---

## 6. Best Deal Selection & ATL Auto-Reconciliation

Best deal calculation is executed via `offerRepo.recomputeBestDealForGame(gameId)` and `BEST_DEAL_RECOMPUTE_ALL_SQL`:

### 6.1 Ranking Hierarchy
```sql
ORDER BY
  CASE
    WHEN (julianday('now') - julianday(COALESCE(o.last_observed_at, o.fetched_at))) * 24 <= 72 THEN 0
    ELSE 1
  END ASC,
  o.price_eur ASC,
  COALESCE(o.last_observed_at, o.fetched_at) DESC
```
1. **Fresh Safe Offers ($\le 72\text{h}$):** Priority 0.
2. **Stale Safe Offers ($> 72\text{h}$):** Priority 1.
3. **Excluded:** Any offer where `is_valid = 0` or `is_likely_pricing_error = 1`.

### 6.2 Instant ATL Auto-Reconciliation
When the winning best safe deal has `price_eur < game.historical_low_eur`:
1. `gameRepo.updateHistoricalLow(gameId, best.price_eur, timestamp, source)` immediately updates `historical_low_eur`, `historical_low_date`, and `historical_low_source`.
2. `BEST_DEAL_RECOMPUTE_ALL_SQL` and database startup sweeps batch-update all games where valid offers undercut recorded historical lows.
