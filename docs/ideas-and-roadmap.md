# 💡 PriceSteamTool — Ideas, Concepts & Strategic Roadmap

> **Comprehensive Innovation Ledger & Feature Backlog**  
> This document captures every architectural idea, feature suggestion, analytical enhancement, integration concept, and long-term vision for the **PriceSteamTool** platform.

---

## 🗺️ Strategic Roadmap Overview

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       Pricetool Evolution Horizon                                      │
├────────────────────────────────┬───────────────────────────────────┬───────────────────────────────────┤
│    Near-Term (v2.8.0–v2.9.0)   │       Mid-Term (v3.0.0–v3.2.0)    │       Long-Term Vision (v3.5+)    │
├────────────────────────────────┼───────────────────────────────────┼───────────────────────────────────┤
│ • Telegram & Pushover Alerts   │ • Epic & GOG Wishlist Support     │ • ML Price Drop Forecasting       │
│ • ProtonDB & Steam Deck Badges │ • Active Game Bundle Aggregator   │ • Multi-User RBAC & Auth          │
│ • HowLongToBeat Value Metric   │ • Smart Cart Budget Optimizer     │ • Decentralized Glitch Network    │
│ • Offsite S3 / WebDAV Backups  │ • Publisher Fake Discount Tracker │ • Native Mobile PWA & Offline     │
│ • Multi-Wishlist Merging       │ • Store-Specific ATL Tracking     │ • Prometheus & Grafana Exporter   │
└────────────────────────────────┴───────────────────────────────────┴───────────────────────────────────┘
```

---

## 1. 🧠 Core Deal Intelligence & Analytical Scoring Ideas

### 1.1 Machine Learning Sale Date & Discount Depth Forecasting
* **Concept**: Train an on-device regression and classification model (or lightweight statistical ARIMA/Prophet time-series model) predicting:
  1. *When* the next sale will occur for each game.
  2. *What* the predicted discount percentage will be.
* **Signals & Features**:
  * Historical days between sales from `price_history`.
  * Official Steam Seasonal Sale dates (Summer, Autumn, Winter, Spring).
  * Publisher sale cadence (e.g., Capcom, Square Enix, Ubisoft quarterly publisher weekends).
  * Game age, DLC release dates, and sequel announcements.
* **User Value**: Instead of guessing whether to wait, the Decision Hero displays:
  > *"Next predicted discount: ~November 26 (Steam Autumn Sale) with an estimated 60% cut (€11.99). Confidence: 88%."*

### 1.2 "Publisher Greed" & Baseline Inflation Tracker
* **Concept**: Track intentional base price hikes occurring prior to major sales.
* **Mechanism**:
  * When `base_price_eur` increases, flag the change in price history.
  * If a game receives a "50% off" discount that yields the exact same monetary price as the previous "30% off" discount due to baseline markup, flag `FAKE_DISCOUNT_PERCENT` and display a "Baseline Price Inflated" badge.
* **User Value**: Exposes deceptive publisher pricing tactics and shields the Deal Score from artificial percentage inflation.

### 1.3 HowLongToBeat (HLTB) Deal Value Metric (€ / Hour of Gameplay)
* **Concept**: Enrich games with gameplay completion times from the HowLongToBeat database.
* **Formula**:
  $$\text{ValuePerHour} = \frac{\text{CurrentBestPriceEur}}{\text{MainStoryHours} \text{ or } \text{CompletionistHours}}$$
* **Example**:
  * *Witcher 3* at €5.99 for 150 hours = **€0.04 / hour** (Incredible Value).
  * 3-hour indie title at €19.99 = **€6.66 / hour** (Low playtime density).
* **UI Presentation**: Add an interactive filter: *"Show deals under €0.25 / hour of gameplay"*.

### 1.4 ProtonDB & Steam Deck Verification Badges
* **Concept**: Direct integration with ProtonDB and Valve's Steam Deck compatibility tier (`Verified`, `Playable`, `Unsupported`).
* **Implementation**:
  * Fetch ProtonDB tier (`Platinum`, `Gold`, `Silver`, `Bronze`, `Borked`) via public API.
  * Store in `games.deck_compatibility` and `games.proton_tier`.
  * Add a quick-filter pill: *"Steam Deck Verified Only"*.
* **User Value**: Crucial for handheld gamers who only want to buy games that run out of the box on SteamOS.

### 1.5 Store-Specific All-Time Low (ATL) Tracking
* **Concept**: Currently, the platform tracks a global All-Time Low across all sources. Expand this to maintain **per-store historical lows**.
* **Use Case**:
  * Steam Store ATL: €9.99.
  * GOG ATL: €4.99.
  * Fanatical ATL: €7.49.
* **User Value**: Users who strictly buy on official stores can see if the game is at its *Steam Storefront record low*, even if a keyshop had it cheaper in 2024.

### 1.6 Regional Price Arbitrage & Purchasing Power Parity (PPP) Explorer
* **Concept**: Visualize regional Steam prices (US, EU, UK, Poland, Ukraine, Turkey, LATAM USD) converted to EUR.
* **Insight**: Highlights games that are heavily overpriced in Eastern/Central Europe compared to standard Western European purchasing power.

---

## 2. 🛒 Shopping, Cart Optimization & Budgeting Ideas

### 2.1 Smart Wishlist Budget Optimizer ("The Cart Allocator")
* **Concept**: The user sets a budget constraint (e.g., *"I have €35.00 / 15 000 Ft to spend today"*).
* **Algorithm**:
  * Solve the 0/1 Knapsack Problem with multi-objective optimization:
    $$\text{Maximize } \sum \left(w_{\text{priority}} \times \text{DealScore}_i \times \text{SteamDbRating}_i\right) \quad \text{subject to } \sum \text{Price}_i \le \text{Budget}$$
* **Output**:
  * "Optimal Cart A (Maximum Deal Quality)": 4 games, total €34.12, average Deal Score 88.
  * "Optimal Cart B (Maximum Playtime Hours)": 3 games, 280 hours of gameplay, total €32.50.
  * "Optimal Cart C (Top Wishlist Priorities)": Top 2 priority titles, total €33.99.

### 2.2 Active Bundle Aggregator (Humble Bundle, Fanatical)
* **Concept**: Cross-reference wishlist items with active mystery bundles, choice bundles, and multi-tier collections on Humble Bundle and Fanatical.
* **Mechanism**:
  * If a game on the user's wishlist is available in the current *Humble Choice* (€11.99 for 8 games), display a prominent badge:
    > *"🎁 Included in Humble Choice (March 2027) along with 7 other titles!"*
* **Impact**: Prevents buying a game standalone for €12 when an entire bundle containing it is available for €11.99.

### 2.3 DLC & "Complete The Set" Calculator
* **Concept**: Optimize the path to owning full editions.
* **Problem**: Often buying the base game + Season Pass separately is more expensive than buying the "Deluxe Edition", but if the user already owns the base game, Steam's dynamic "Complete Your Collection" bundle offers an extra 10–30% discount.
* **Solution**: Inspect user Steam library ownership and calculate the exact lowest cost to reach 100% content completeness.

### 2.4 Friend Wishlist Overlap & Co-Op Matcher
* **Concept**: Ingest friends' public Steam wishlists.
* **Features**:
  * **Co-Op Sales**: *"These 3 games on your wishlist with co-op tags are also on [Friend's] wishlist and currently on sale."*
  * **Gift Recommendations**: Identifies which of your friends' wishlist games are currently at an Exceptional Deal Score ($\ge 80$), ideal for birthday/holiday gifting.

---

## 3. 📡 Integrations, Alerts & Notification Channels

### 3.1 Telegram Bot with Interactive Callbacks
* **Concept**: Official Telegram bot integration alongside Discord webhooks.
* **Features**:
  * Inline query support (`@PriceSteamBot Cyberpunk` to check live deals anywhere in Telegram).
  * Push alerts with interactive inline buttons:
    * `[🛒 Direct Store Link]`
    * `[🎮 View on Steam]`
    * `[✅ Log Purchase / Megvettem]`
    * `[🔕 Mute for 7 Days]`
  * Slash commands: `/deals`, `/stats`, `/top`, `/search <title>`.

### 3.2 Mobile Push Notifications via ntfy.sh and Pushover
* **Concept**: Ultra-lightweight, privacy-first push notifications to iOS and Android devices without requiring a proprietary mobile app.
* **Implementation**:
  * User provides an `ntfy.sh` topic or Pushover user key in Settings.
  * High-priority deal and glitch alerts trigger instant phone notifications with sound and action links.

### 3.3 Email Digest & Weekly Newsletter
* **Concept**: Optional scheduled SMTP email dispatch (every Friday morning or at the start of seasonal sales):
  * "Your Weekly Steam Wishlist Digest":
    * 🌟 3 New All-Time Lows.
    * 🔥 5 Deals Ending Soon.
    * 💸 Realized Savings update.

### 3.4 Matrix / Element & Webhook Dispatcher
* **Concept**: Generic webhook event broadcaster allowing self-hosters to route deal events into Home Assistant, Matrix chat rooms, Slack, or Node-RED automation pipelines.

---

## 4. 🌐 Multi-Storefront Expansion

### 4.1 GOG (Good Old Games) Wishlist & Library Integration
* **Concept**: Allow users to connect a GOG account.
* **Capabilities**:
  * Ingest GOG wishlist alongside Steam wishlist.
  * Direct GOG Galaxy DRM-free deal matching.
  * Filter by "DRM-Free Available".

### 4.2 Epic Games Store (EGS) Wishlist & Freebies Tracker
* **Concept**:
  * Ingest public Epic Games Store wishlists.
  * Active weekly 100% off Epic Freebies radar: notify user immediately when a wishlist game becomes free on Epic.

### 4.3 Console Storefront Support (PlayStation Network & Xbox Store)
* **Concept**: For multi-platform gamers, track cross-platform availability.
* **User Value**: Displays if a Steam wishlist game is currently available on Xbox Game Pass (PC/Console) or PlayStation Plus Extra.

---

## 5. 📱 Frontend & User Experience Innovations

### 5.1 Progressive Web App (PWA) with Offline Deals Cache
* **Concept**: Turn the Vite React SPA into an installable PWA with Service Worker caching.
* **Features**:
  * Add to Home Screen on iOS / Android / macOS / Windows.
  * Offline browsing of previously synced wishlist deals and price history charts.
  * Native background sync and badge count on app icon for active unread deals.

### 5.2 Interactive Deal History Comparison ("Slider Time Machine")
* **Concept**: An interactive timeline slider in the dashboard that lets the user see what the wishlist looked like during:
  * Steam Summer Sale 2026.
  * Black Friday 2025.
  * Winter Sale 2024.
* **Insight**: Evaluate whether sales are getting better or worse over time.

### 5.3 Quick Batch Actions & Wishlist Tagging
* **Concept**: Allow custom user tags and notes directly on wishlist games:
  * Tags: `Backlog`, `Must Play 2027`, `Wait for DLC`, `Co-op with Dave`, `Steam Deck Only`.
  * Multi-select checkboxes for batch actions (e.g. set target price on 10 games at once).

### 5.4 Audio & Sound Feedback
* **Concept**: Subtle, tasteful 8-bit or mechanical tactile sound effects (toggleable in settings) for:
  * Sync completed chime.
  * "Megvettem" purchase registered sound.
  * Glitch hunter detected alert.

---

## 6. 🛠️ Infrastructure, Security & DevOps Ideas

### 6.1 Automated Offsite Cloud & NAS Backups
* **Concept**: Extend the zero-downtime SQLite backup engine to dispatch encrypted snapshots to external remotes:
  * Native S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, Wasabi).
  * WebDAV / Synology NAS / Nextcloud.
  * rclone integration for Google Drive, OneDrive, Dropbox.
* **Retention Policy**: Hourly local $\rightarrow$ Daily offsite $\rightarrow$ Weekly archive.

### 6.2 Multi-User Support with Role-Based Access Control (RBAC)
* **Concept**: Transition from a single-family instance to a multi-tenant personal hub.
* **Architecture**:
  * `users` table with Argon2id password hashing and session tokens.
  * Roles: `Admin` (can manage adapters, API keys, sync schedules), `Member` (can add personal profiles, manage their own wishlist, log their own purchases).
  * Isolated personal purchase journals while sharing the global cached deal index.

### 6.3 Prometheus Metrics Exporter & Grafana Dashboard
* **Concept**: Expose `/metrics` in OpenMetrics/Prometheus format.
* **Metrics**:
  * `pricetool_games_total`, `pricetool_offers_active`.
  * `pricetool_adapter_requests_total{source, status}`.
  * `pricetool_circuit_breaker_state{source}`.
  * `pricetool_sync_duration_seconds`.
  * `pricetool_pricing_errors_active`.
* **Deliverable**: Pre-built Grafana JSON dashboard for dockerized home-lab monitoring.

### 6.4 SQLite Performance: Worker Threads for Tukey IQR Analytics
* **Concept**: Offload computation of Tukey IQR typical sale medians and rolling period lows for 5,000+ games to a Node.js `worker_threads` pool.
* **Benefit**: Zero main-thread event loop blocking during heavy post-sync batch statistics recalculations.

### 6.5 Decentralized Peer Glitch Consensus (Opt-In)
* **Concept**: An opt-in, privacy-preserving gossip protocol or central hash-relay where self-hosted PriceSteamTool instances report confirmed pricing errors.
* **Outcome**: When one instance discovers a sub-euro pricing glitch on a game, all participating instances receive a zero-delay Glitch Hunter notification without running independent crawls.

---

## 7. 📋 Implementation Feasibility & Impact Matrix

| Idea / Concept | Technical Complexity | User Value | Recommended Priority | Target Milestone |
| :--- | :---: | :---: | :---: | :---: |
| **Telegram Bot Alerts & Commands** | Low | High | **P1 (Immediate)** | v2.8.0 |
| **Steam Deck & ProtonDB Badges** | Low | High | **P1 (Immediate)** | v2.8.0 |
| **HowLongToBeat Value Metric (€/h)** | Low-Medium | High | **P1 (Immediate)** | v2.8.0 |
| **Automated S3 / WebDAV Offsite Backup** | Low-Medium | Very High | **P1 (Immediate)** | v2.8.0 |
| **Store-Specific Historical Lows** | Medium | Medium | **P2 (Near-Term)** | v2.9.0 |
| **Active Bundle Aggregator (Humble/Fanatical)**| Medium | High | **P2 (Near-Term)** | v2.9.0 |
| **Smart Cart Budget Optimizer** | Medium | Very High | **P2 (Near-Term)** | v3.0.0 |
| **Publisher Fake Discount / Inflation Tracker**| Medium | High | **P2 (Near-Term)** | v3.0.0 |
| **GOG & Epic Store Ingestion** | High | High | **P2 (Near-Term)** | v3.0.0 |
| **Progressive Web App (PWA) & Offline** | Medium | High | **P2 (Near-Term)** | v3.1.0 |
| **Prometheus Exporter & Grafana** | Low | Medium | **P3 (Future)** | v3.2.0 |
| **Multi-User RBAC Authentication** | High | High | **P3 (Future)** | v3.5.0 |
| **ML Sale Prediction Engine** | High | Very High | **P3 (Future)** | v3.5.0 |
| **Decentralized Glitch Consensus Network** | Very High | Very High | **P4 (Visionary)** | v4.0.0 |

---

*This ideas ledger is maintained and expanded by the PriceSteamTool core engineering team.*
