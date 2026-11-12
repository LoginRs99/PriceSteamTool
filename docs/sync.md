# Synchronization & Rate Limiting Engine

This document details the synchronization workflow, queue orchestrator, circuit breaker state machine, data normalization pipeline, sync runs tracking, and pricing error detection engine for **Pricetool** (v2.10.2).

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
                    │   NEXARDA & SDB (Secondary)       │
                    │   - Direct API v3/v1 Lookup       │
                    │   - Voucher code support          │
                    │   - Pacing: 250ms - 500ms         │
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

5. **NEXARDA & SuperDuperBundle Workers (Keyshop & Aggregator Integration)**:
   * **NEXARDA**: Queries verified official stores and keyshops with net pricing and voucher codes (`NEXARDA_DELAY_MS=500`).
   * **SuperDuperBundle**: Batched multi-game lookup in 50-game chunks with resilient error recovery (`SUPERDUPERBUNDLE_DELAY_MS=1000`).

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
* **NORMAL**: Full operation, requests dispatched at configured interval + jitter. Successful requests automatically clear `last_error` to `NULL` in the database, ensuring resolved notes disappear from the UI immediately.
* **BACKOFF**: Source encountered transient error (e.g. 429 or timeout); paused for 30 seconds before retrying job.
* **PAUSED**: Repeated failures exceeded threshold. Source queue paused. Other source queues continue unimpeded.
* **COOLDOWN**: Source cooldown timer expired; dispatches a single test probe. If successful, state resets to `NORMAL`.

### Circuit Breaker Self-Healing & Manual Controls:
* **Automatic Note Dismissal**: In both SQLite and in-memory registry, `last_error` is automatically set to `NULL` upon the very next successful request. When an adapter returns to `NORMAL` status, past error notes disappear immediately without lingering.
* **Interactive Reset & Unpause**: Users can unpause any degraded or paused source with 1 click via the "Reset / Unpause" button in `SourcesModal` or via `POST /api/sources/:code/reset`. This resets consecutive failure counters, clears cooldowns, and wakes up pending queues.
* **Toggle Auto-Reset**: Re-enabling a disabled adapter automatically triggers a circuit reset, allowing immediate retry.

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
2. **`SOURCE_FAMILY_CONFLICT` (Direct Anomaly):**
   * Evaluates intra-family price splits between official stores and marketplace keyshops reported under the same source aggregator (e.g. GG.deals).
   * **Known ATL Exemption**: Offers at or above a known confirmed low (`price >= ATL - 0.05`) are immune.
   * **Standard Sales Band**: For `price > 1.005 €`, requires an extreme uncorroborated ratio $\ge 12.0\times$ (allowing normal 80%–85% keyshop discount depths on catalog games). Sub-euro glitches ($\le 1.005\text{ €}$) require a $\ge 3.0\times$ ratio.
3. **`MARKET_OUTLIER` (Weight: 0.25–0.40):**
   * Lone outlier $> 50\%$ below a single peer, or $> 75\%$ below multi-peer median (unless price matches or beats confirmed ATL).
4. **`BELOW_ATL_IMPLAUSIBLE` (Weight: 0.35):**
   * Price is $> 50\%$ below confirmed All-Time Low on established games.
5. **`OWN_HISTORY_BREAK` (Weight: 0.30):**
   * Merchant's own price history shows a sudden collapse ($z > 2.5$) vs historical median.
6. **`FRESH_RELEASE_DROP` (Weight: 0.35):**
   * Discount $> 40\%$ on games released $< 30$ days ago without official publisher confirmation.
7. **`EDITION_INVERSION` (Weight: 0.30):**
   * Deluxe/Gold/Complete edition priced $> 30\%$ below base game.
8. **`FAKE_DISCOUNT` (Weight: 0.20):**
   * Claimed original price $> 1.5\times$ base Steam MSRP.

### 5.2 Independent Peer Corroboration Override
If an offer triggers selling-price signals (`DECIMAL_SHIFT`, `MARKET_OUTLIER`, `SOURCE_FAMILY_CONFLICT`), but $\ge 2$ independent fresh peer prices match within $\pm 20\%$ or $\pm 1.50\text{ €}$, the selling price is authenticated:
* `errorEval.isLikelyPricingError` is set to `false`.
* Selling price anomaly flags are suppressed, while metadata anomalies (`FAKE_BASELINE`, `EDITION_INVERSION`) remain independently evaluated.
* The offer remains active as a legitimate market promotion.

### 5.3 Automated Self-Healing & Dismissal
* **On Server Startup & Post-Sync Sweeps:** `purgeCorruptedPricingErrors()` in `src/server/db/cleanData.ts` automatically dismisses active false positives:
  1. `SOURCE_FAMILY_CONFLICT` on official retailers, corroborated offers, prices $\ge \text{ATL} - 0.05$, or catalog keyshop prices $> 1.005\text{ €}$ with official peer ratio $< 12.0\times$.
  2. `FAKE_BASELINE` where selling price is at or above Steam base MSRP or on official stores.
  3. `MARKET_OUTLIER` where price is within 0.55 of min peer or gap $< 2.00\text{ €}$.
  4. `DECIMAL_SHIFT` on official store sales ($\ge 0.70\text{ €}$) or peer-corroborated sub-euro deals.
* **Best Deal Recomputation:** Whenever false positives are dismissed, `BEST_DEAL_RECOMPUTE_ALL_SQL` is executed to re-elect active offers as the best deal.

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
  m.is_official DESC,
  COALESCE(o.last_observed_at, o.fetched_at) DESC
```
1. **Fresh Safe Offers ($\le 72\text{h}$):** Priority 0.
2. **Stale Safe Offers ($> 72\text{h}$):** Priority 1.
3. **Lowest Normalized Price:** `o.price_eur ASC`.
4. **Official Store Tie-Breaker Priority:** `m.is_official DESC` (if an authorized official retailer and a keyshop match the exact same price, the official store is preferentially crowned as the winning Best Deal).
5. **Observation Recency:** `COALESCE(o.last_observed_at, o.fetched_at) DESC`.
6. **Excluded:** Any offer where `is_valid = 0` or `is_likely_pricing_error = 1`.

### 6.2 Instant ATL Auto-Reconciliation
When the winning best safe deal has `price_eur < game.historical_low_eur`:
1. `gameRepo.updateHistoricalLow(gameId, best.price_eur, timestamp, source)` immediately updates `historical_low_eur`, `historical_low_date`, and `historical_low_source`.
2. `BEST_DEAL_RECOMPUTE_ALL_SQL` and database startup sweeps batch-update all games where valid offers undercut recorded historical lows.

### 6.3 ATL Quarantine & Single-Source Protection
To prevent unverified keyshop listings from permanently poisoning `games.historical_low_eur` and corrupting typical sale medians:
* If a new record low is reported solely by a single unverified keyshop source without peer corroboration, the offer is quarantined from immediately overwriting `games.historical_low_eur`.
* The low is flagged with `atl_is_confirmed = 0` and `atl_is_single_source_low = 1`.
* Only when the price is confirmed by an authorized official retailer or corroborated by $\ge 2$ independent peers is it promoted to confirmed ATL.

---

## 7. Sync Runs Tracking & High-Performance Data Purging

### 7.1 Granular Sync Telemetry (`sync_runs`)
Every synchronization pass creates an execution record in `sync_runs`:
* Tracks `trigger_type` (`MANUAL`, `SCHEDULED`, `STARTUP`), `status` (`RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED`), start/completion timestamps, total games scheduled, processed games count, and new/updated offers count.
* Enables operational visibility and health telemetry via `/api/sync/overview`.

### 7.2 Non-Blocking Chunked Data Purging
* Old price history records older than the retention threshold are purged via `purgeOldPriceHistory()`.
* Deletions execute in isolated chunks of 1,000 rows to prevent long-held SQLite write transaction locks and avoid blocking incoming API reads or active sync tasks.
* Automatic `PRAGMA optimize; ANALYZE;` post-sync hooks update SQLite query planner statistics for sustained sub-millisecond query performance.
