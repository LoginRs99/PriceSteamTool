# Synchronization & Rate Limiting Engine

This document details the synchronization workflow, queue orchestrator, circuit breaker state machine, and data normalization pipeline.

---

## 1. Synchronization Flow

```text
               User clicks "Sync Wishlist"
                            │
                            ▼
            ┌───────────────────────────────┐
            │    Steam Wishlist Ingestion   │
            │  (Fetches active AppID list)  │
            └───────────────┬───────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │   Catalog & AppID Resolution  │
            │  (Batch ITAD lookup & Details)│
            └───────────────┬───────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
              ▼                           ▼
    ┌──────────────────┐        ┌──────────────────┐
    │    ITAD Queue    │        │  GG.deals Queue  │ (CheapShark, etc.)
    │  - 200 items/req │        │  - 1 item / 1.5s │
    │  - 1 req / 1.0s  │        │  - Jitter: 200ms │
    └─────────┬────────┘        └─────────┬────────┘
              │                           │
              └─────────────┬─────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │   Normalization & Filtering   │
            │  - Product: Steam Key / Gift  │
            │  - Region: EU / HU / Global   │
            │  - Exclude: Accounts / Others │
            └───────────────┬───────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │  Deduplication & Observation  │
            │  - Canonical Offer matching   │
            │  - Multi-source confirmation  │
            └───────────────┬───────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │   Price Anomaly Scoring &     │
            │     Best Price Selection      │
            └───────────────┬───────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │  Database Write & SSE Event   │
            │ (Real-time progress broadcast)│
            └───────────────────────────────┘
```

---

## 2. Source Queue Pacing & Token Bucket

Each source adapter operates with an isolated token-bucket queue:

1. **Steam Storefront Worker (Batch API)**:
   * Chunks wishlist entries into 200 items per request.
   * Delay: 1000ms.
   * Ingests baseline MSRP and Steam Store discounts in ~2 seconds.

2. **ITAD Batch Worker (Batch API)**:
   * Chunks out-of-date games into batches of 150 IDs.
   * Delay: 500ms between batch requests.
   * Total requests for 2,570 games: **~17 requests (~15 seconds total)**.

3. **CheapShark Batch Worker (Batch API)**:
   * Chunks games into batches of 50–60 Steam AppIDs per `/deals` call.
   * Delay: 500ms between batch requests.
   * Total requests for 2,570 games: **~50 requests (~20–25 seconds total)**.

4. **GG.deals Worker (Batch / Selective API)**:
   * Delay: 1000ms. Refreshes batch catalog in parallel.

5. **AllKeyShop Worker (Smart Priority Scraping)**:
   * Uses AllKeyShop's structured `vaks.php` v2 JSON API.
   * Pacing: 2500ms delay for TOP 150 priority games (~6 minutes total).
   * Fallback Circuit Breaker protects against anti-bot challenges.

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
* **NORMAL**: Full operation, requests dispatched at configured interval.
* **BACKOFF**: Source encountered transient errors (e.g. 429 or timeout); paused for 30 seconds before retrying current job.
* **PAUSED**: Repeated failures exceeded threshold. Source queue paused for 15–30 minutes. Other source queues continue unimpeded.
* **COOLDOWN**: Source cooldown expired; dispatches a single test probe. If successful, state resets to `NORMAL`.

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

## 5. Anomaly Detection Engine

A price is marked as an anomaly when:
1. **Extreme Discount**: Discount is > 90% and merchant is not an official authorized retailer.
2. **Median Deviation**: Price is < 20% of the median price across all other verified stores.
3. **MSRP Discrepancy**: Price is < €1.00 for a game with Steam base price > €29.99 unless confirmed by Steam Store directly.

Anomalies remain visible in the UI with a distinct warning badge (`⚠ Possible price anomaly`) so the user can verify manually.
