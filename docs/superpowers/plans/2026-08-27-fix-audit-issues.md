# Codebase Audit 8-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the 8 confirmed reliability, data integrity, region validation, and state bugs verified during the codebase audit.

**Architecture:** Target exact bug locations in `src/server/sources/steam.ts`, `src/server/sources/allkeyshop.ts`, `src/server/db/repositories/offer.ts`, `src/server/sync/orchestrator.ts`, `src/server/domain/normalizer.ts`, and `src/server/sync/circuitBreaker.ts`. Keep implementation strictly focused and simple without adding unnecessary abstractions.

**Tech Stack:** TypeScript, Node.js, SQLite (better-sqlite3)

---

### Task 1: Fix Steam Partial Wishlist Data Loss (Issue 1)

**Files:**
- Modify: `src/server/sources/steam.ts`

**Interfaces:**
- Consumes: `steamId64`
- Produces: `Promise<SteamWishlistItem[]>`

- [ ] **Step 1: Update `steam.ts` to throw error on pagination failure**
In `src/server/sources/steam.ts`, line 147-154, modify catch block so that if a page fails to fetch, `fetchWishlist` throws an error instead of breaking out and returning partial results.

---

### Task 2: Fix AllKeyShop Solver Error Swallowing (Issue 3)

**Files:**
- Modify: `src/server/sources/allkeyshop.ts`

**Interfaces:**
- Consumes: `url: string`, `timeoutMs: number`
- Produces: `Promise<T>` (throws on failure when solver is configured)

- [ ] **Step 1: Update `fetchWithAllkeyshopSolver` in `allkeyshop.ts`**
Change `fetchWithAllkeyshopSolver` so HTTP errors, connection timeouts, and challenge failures throw errors instead of returning `null` when a solver URL is configured.

---

### Task 3: Fix Price History Source Collision (Issue 8)

**Files:**
- Modify: `src/server/db/repositories/offer.ts`

**Interfaces:**
- Consumes: `gameId`, `merchantId`, `sourceCode`, `productType`, `regionType`
- Produces: `lastHistory` row scoped to exact source observation attributes

- [ ] **Step 1: Update `lastHistory` query in `offerRepo.upsertOffer`**
In `src/server/db/repositories/offer.ts`, update `lastHistory` query to match `source_code = ?`.

---

### Task 4: Fix Cancellation Status Bug (Issue 6)

**Files:**
- Modify: `src/server/sync/orchestrator.ts`

**Interfaces:**
- Consumes: `this.isCancelled`
- Produces: Correct sync status and termination on cancellation

- [ ] **Step 1: Add `isCancelled` guard after `Promise.allSettled(batchTasks)`**
In `src/server/sync/orchestrator.ts`, add `if (this.isCancelled) return;` immediately after `await Promise.allSettled(batchTasks)`.

---

### Task 5: Fix Unknown Region Validation (Issue 7)

**Files:**
- Modify: `src/server/domain/normalizer.ts`

**Interfaces:**
- Consumes: `rawRegion: string`, `rawCountry: string`
- Produces: `NormalizedRegion` with `isValid: false` for unrecognized regions

- [ ] **Step 1: Update `normalizeRegion()` fallback**
In `src/server/domain/normalizer.ts`, change fallback for unrecognized region codes/strings to return `isValid: false` and `regionType: 'RESTRICTED'`.

---

### Task 6: Fix AllKeyShop Candidate Sub-Pacing (Issue 2)

**Files:**
- Modify: `src/server/sources/allkeyshop.ts`

**Interfaces:**
- Consumes: candidate games loop
- Produces: 500ms delay between candidate solver calls within a game task

- [ ] **Step 1: Add delay between candidate probes in `allkeyshopAdapter.fetchPricesForGame()`**
In `src/server/sources/allkeyshop.ts`, add a 500ms delay between candidate probes in the candidate loop.

---

### Task 7: Fix AllKeyShop Failed-Check Timestamp (Issue 13)

**Files:**
- Modify: `src/server/sync/orchestrator.ts`

**Interfaces:**
- Consumes: background enrichment loop
- Produces: `updateAllkeyshopCheckState` called ONLY on successful game fetch

- [ ] **Step 1: Move `updateAllkeyshopCheckState` inside the successful fetch try block**
In `src/server/sync/orchestrator.ts`, move `updateAllkeyshopCheckState` inside the `try` block so it is called ONLY when `fetchPricesForGame` completes without throwing.

---

### Task 8: Fix Circuit Breaker Restart Counters (Issue 4)

**Files:**
- Modify: `src/server/sync/circuitBreaker.ts`

**Interfaces:**
- Consumes: `sourceRepo.list()`
- Produces: `consecutiveFailures: 0`, `consecutiveRateLimits: 0` on startup

- [ ] **Step 1: Reset consecutive counters on startup in `circuitBreaker.ts`**
In `src/server/sync/circuitBreaker.ts`, change `initFromDb()` to set `consecutiveFailures: 0` and `consecutiveRateLimits: 0`.
