# Domain Data Model

This document outlines the database schema, entity relationships, normalization strategies, and data lifecycle for **Pricetool** (v2.3.0).

---

## 1. Entity-Relationship Overview

```text
┌────────────────────┐          ┌───────────────────────┐          ┌────────────────────┐
│      Profile       │1        *│    WishlistEntry      │*        1│        Game        │
│  (Steam Account,   ├──────────┤ (Priority, Added Date,├──────────┤ (Steam AppID, MSRP,│
│   is_family flag)  │          │  Target Price)        │          │  ATL, Reviews,     │
└─────────┬──────────┘          └───────────────────────┘          │  Metacritic, Stats)│
          │1                                                       └───┬──────┬─────┬───┘
          │*                                                           │1     │1    │1
┌─────────▼──────────┐                                                 │*     │*    │*
│  FamilyOwnedApp    │          ┌───────────────────────┐          ┌───▼────┐ │   ┌─▼────────────────┐
│ (Steam AppID link) │          │   SourceObservation   │*        1│ Offer  │ │   │   SteamAsset     │
└────────────────────┘          │  (Source, Raw Price,  ├──────────┤(Best,  │ │   │(Header, Capsule, │
                                │   Observed At)        │          │ Valid, │ │   │ Hero Artwork)    │
                                └───────────▲───────────┘          │ Error) │ │   └──────────────────┘
                                            │*                     └───┬────┘ │
┌────────────────────┐          ┌───────────┴───────────┐              │1     │1
│      Merchant      │1        *│        Source         │              │*     │*
│ (Store / Shop,     ├──────────┤(Steam, ITAD, GGDeals, │          ┌───▼──────▼─────────┐
│  is_official flag) │          │ CheapShark, Keyshop)  │          │   PricingError     │
└─────────┬──────────┘          └───────────────────────┘          │ (Error Type, Score,│
          │1                                                       │  Dismissal State)  │
          │*                                                       └────────────────────┘
┌─────────▼──────────┐
│    PriceHistory    │
│(Recorded Movement, │
│ Deal Score, Error) │
└────────────────────┘
```

---

## 2. Schema Specification (SQLite with WAL Mode)

### 2.1 Profiles (`profiles`)
Tracks registered Steam accounts, including family library profiles.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Internal profile UUID |
| `name` | TEXT | NOT NULL | Display name (e.g. "Primary Steam Wishlist") |
| `steam_id` | TEXT | UNIQUE NOT NULL | 64-bit Steam Community ID |
| `custom_url` | TEXT | NULLABLE | Steam vanity URL slug |
| `avatar_url` | TEXT | NULLABLE | Steam profile avatar image URL |
| `is_active` | INTEGER | NOT NULL DEFAULT 1 | Active profile in UI |
| `is_family` | INTEGER | NOT NULL DEFAULT 0 | 1 if profile is a Steam Family Sharing member |
| `created_at` | TEXT | NOT NULL | ISO 8601 creation timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601 update timestamp |

### 2.2 Games (`games`)
Canonical metadata, MSRP anchor, historical lows, Deal Score statistics, review ratings, and enrichment.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Internal game UUID |
| `steam_app_id` | INTEGER | UNIQUE NOT NULL | Canonical Steam Application ID |
| `itad_id` | TEXT | NULLABLE | IsThereAnyDeal internal UUID |
| `title` | TEXT | NOT NULL | Game title |
| `slug` | TEXT | NOT NULL | URL-safe slug |
| `header_image` | TEXT | NULLABLE | Store banner image URL |
| `capsule_image`| TEXT | NULLABLE | Small thumbnail image URL |
| `release_date` | TEXT | NULLABLE | Release date string |
| `is_dlc` | INTEGER | NOT NULL DEFAULT 0 | 1 if downloadable content, 0 if base game |
| `is_free` | INTEGER | NOT NULL DEFAULT 0 | 1 if free-to-play |
| `is_delisted` | INTEGER | NOT NULL DEFAULT 0 | 1 if removed/delisted from Steam Store |
| `base_price_eur` | REAL | NULLABLE | Baseline Steam MSRP in EUR |
| `historical_low_eur` | REAL | NULLABLE | Lowest recorded valid price in EUR (auto-reconciled) |
| `historical_low_date` | TEXT | NULLABLE | Timestamp when historical low was established |
| `historical_low_source` | TEXT | NULLABLE | Store/source establishing historical low |
| `typical_sale_median_eur` | REAL | NULLABLE | Tukey IQR typical sale median price in EUR |
| `typical_sale_q1_eur` | REAL | NULLABLE | Tukey IQR 25th percentile price in EUR |
| `typical_sale_q3_eur` | REAL | NULLABLE | Tukey IQR 75th percentile price in EUR |
| `typical_sale_sample_count` | INTEGER | NULLABLE | Count of sale price samples used for IQR |
| `typical_sale_low_confidence` | INTEGER | NULLABLE | 1 if $< 5$ samples available |
| `low_90d_eur` | REAL | NULLABLE | Lowest safe price in past 90 days (null if insufficient history) |
| `low_1y_eur` | REAL | NULLABLE | Lowest safe price in past 365 days (null if insufficient history) |
| `atl_is_confirmed` | INTEGER | DEFAULT 1 | 1 if confirmed by official store or multi-peer agreement |
| `atl_is_single_source_low` | INTEGER | DEFAULT 0 | 1 if ATL was reported by single keyshop source |
| `price_tracking_first_observed_at` | TEXT | NULLABLE | First recorded observation timestamp |
| `best_offer_source_count` | INTEGER | NULLABLE | Number of distinct sources corroborating current best deal |
| `deal_score_stats_updated_at` | TEXT | NULLABLE | Timestamp of last statistical recalculation |
| `price_history_seeded_at` | TEXT | NULLABLE | Timestamp of historical price ingestion |
| `allkeyshop_last_checked_at` | TEXT | NULLABLE | Last AllKeyShop enrichment check timestamp |
| `allkeyshop_check_interval_hours` | INTEGER | DEFAULT 24 | Adaptive check interval (24h to 168h ceiling) |
| `allkeyshop_unchanged_streak` | INTEGER | DEFAULT 0 | Consecutive runs with unchanged keyshop price |
| `allkeyshop_last_price_eur` | REAL | NULLABLE | Previous keyshop price for stability tracking |
| `steam_review_desc` | TEXT | NULLABLE | Steam review sentiment text (e.g. "Very Positive") |
| `steam_review_percent` | INTEGER | NULLABLE | Steam positive review percentage (0–100) |
| `steam_review_total` | TEXT | NULLABLE | Formatted total review count |
| `steamdb_rating` | REAL | NULLABLE | Bayesian Wilson score rating |
| `metacritic_score` | INTEGER | NULLABLE | Metacritic score (0–100) enriched via CheapShark |
| `metacritic_url` | TEXT | NULLABLE | Metacritic review page URL |
| `created_at` | TEXT | NOT NULL | ISO 8601 creation timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601 update timestamp |

### 2.3 Wishlist Entries (`wishlist_entries`)
User wishlist rankings and custom price targets.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Wishlist entry UUID |
| `profile_id` | TEXT | NOT NULL REFERENCES profiles(id) | Associated profile |
| `game_id` | TEXT | NOT NULL REFERENCES games(id) | Associated game |
| `priority` | INTEGER | NOT NULL DEFAULT 0 | Steam Wishlist ranking priority |
| `date_added_steam` | TEXT | NULLABLE | Timestamp added to Steam Wishlist |
| `target_price_eur` | REAL | NULLABLE | Optional user price alert threshold in EUR |
| `is_active` | INTEGER | NOT NULL DEFAULT 1 | 1 if active in latest sync, 0 if removed |
| `last_synced_at` | TEXT | NOT NULL | Timestamp of last sync pass |

### 2.4 Merchants (`merchants`)
Digital retailers and marketplaces. Note: Artificial `trust_score` was dropped in migration 023 in favor of objective official retailer status.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Merchant UUID |
| `code` | TEXT | UNIQUE NOT NULL | Canonical code (`steam`, `fanatical`, `humble`, `eneba`, etc.) |
| `name` | TEXT | NOT NULL | Display name |
| `default_url` | TEXT | NULLABLE | Store homepage URL |
| `is_official` | INTEGER | NOT NULL DEFAULT 1 | 1 for authorized retailer, 0 for marketplace keyshop |
| `created_at` | TEXT | NOT NULL | ISO 8601 creation timestamp |

### 2.5 Offers (`offers`)
Canonical deduplicated store offers with pricing error markers.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Canonical offer UUID |
| `game_id` | TEXT | NOT NULL REFERENCES games(id) | Target game |
| `merchant_id` | TEXT | NOT NULL REFERENCES merchants(id) | Selling store |
| `product_type` | TEXT | NOT NULL | `STEAM_KEY`, `STEAM_GIFT`, `DIRECT_PURCHASE` |
| `region_type` | TEXT | NOT NULL | `GLOBAL`, `EU`, `HU`, `RESTRICTED` |
| `region_code` | TEXT | NULLABLE | ISO region or `WW`/`EU` |
| `region_confidence` | REAL | NOT NULL DEFAULT 1.0 | 0.0–1.0 region compatibility score |
| `price_eur` | REAL | NOT NULL | Normalized purchase price in EUR |
| `original_price_eur` | REAL | NULLABLE | Base MSRP before discount in EUR |
| `raw_price` | REAL | NULLABLE | Un-converted price from store |
| `raw_currency` | TEXT | DEFAULT 'EUR' | Store currency (`EUR`, `USD`, `GBP`, `HUF`) |
| `raw_original_price` | REAL | NULLABLE | Un-converted original base price |
| `discount_percent` | INTEGER | NOT NULL DEFAULT 0 | Calculated discount percentage |
| `voucher_code` | TEXT | NULLABLE | Public voucher/coupon code |
| `deal_url` | TEXT | NOT NULL | Direct deal link |
| `is_best_deal` | INTEGER | NOT NULL DEFAULT 0 | 1 if active best valid offer |
| `is_valid` | INTEGER | NOT NULL DEFAULT 1 | 1 if valid, 0 if filtered |
| `price_event` | TEXT | NOT NULL DEFAULT 'NONE' | `NEW_HISTORICAL_LOW`, `RECORD_DROP`, `MAJOR_DROP`, etc. |
| `is_likely_pricing_error` | INTEGER | NOT NULL DEFAULT 0 | 1 if flagged as pricing glitch (excluded from best deal) |
| `pricing_error_confidence` | REAL | NOT NULL DEFAULT 0.0 | Confidence score of error detection (0.00–1.00) |
| `pricing_error_type` | TEXT | NULLABLE | `DECIMAL_SHIFT`, `MARKET_OUTLIER`, `FAKE_DISCOUNT`, etc. |
| `pricing_error_reason` | TEXT | NULLABLE | Human-readable explanation of error |
| `fetched_at` | TEXT | NOT NULL | Initial record timestamp |
| `last_observed_at` | TEXT | NULLABLE | Most recent observation timestamp |
| `created_at` | TEXT | NOT NULL | Record creation timestamp |
| `updated_at` | TEXT | NOT NULL | Record update timestamp |

### 2.6 Pricing Errors (`pricing_errors`)
Dedicated isolated table storing active and dismissed pricing glitches. Replaces legacy `anomalies` table (a backward-compatible `anomalies` view with `INSTEAD OF` triggers exists for legacy queries).
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Error record UUID |
| `game_id` | TEXT | NOT NULL REFERENCES games(id) | Associated game |
| `offer_id` | TEXT | NOT NULL REFERENCES offers(id) | Flagged offer |
| `error_type` | TEXT | NOT NULL | Canonical error type (`DECIMAL_SHIFT`, `MARKET_OUTLIER`, etc.) |
| `confidence` | REAL | NOT NULL | Error detection confidence score |
| `reason` | TEXT | NOT NULL | Explanatory reason string |
| `detected_at` | TEXT | NOT NULL | Timestamp when error was detected |
| `is_dismissed` | INTEGER | NOT NULL DEFAULT 0 | 1 if dismissed by user or self-healing sweep |

### 2.7 Source Observations (`source_observations`)
Raw provenance records from each adapter supporting a canonical offer.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Observation UUID |
| `offer_id` | TEXT | NOT NULL REFERENCES offers(id) | Associated canonical offer |
| `source_code` | TEXT | NOT NULL | `steam`, `itad`, `cheapshark`, `ggdeals`, `allkeyshop` |
| `observed_price_eur` | REAL | NOT NULL | Normalized EUR price observed by this source |
| `observed_raw_price` | REAL | NULLABLE | Raw price string/number from source payload |
| `observed_currency` | TEXT | DEFAULT 'EUR' | Original currency reported by source |
| `observed_at` | TEXT | NOT NULL | Timestamp of observation |
| `raw_data_json` | TEXT | NULLABLE | Debug JSON payload |

### 2.8 Price History (`price_history`)
Immutable audit log of historical price shifts.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | History entry UUID |
| `game_id` | TEXT | NOT NULL REFERENCES games(id) | Associated game |
| `merchant_id` | TEXT | NOT NULL REFERENCES merchants(id) | Associated merchant |
| `source_code` | TEXT | NOT NULL | Ingesting adapter code |
| `price_eur` | REAL | NOT NULL | Normalized purchase price in EUR |
| `raw_price` | REAL | NULLABLE | Original raw currency price |
| `raw_currency` | TEXT | DEFAULT 'EUR' | Original raw currency |
| `fx_rate` | REAL | DEFAULT 1.0 | Exchange rate used at time of observation |
| `discount_percent` | INTEGER | NULLABLE | Discount percentage |
| `price_event` | TEXT | NULLABLE | Classified price movement event |
| `deal_score` | INTEGER | NULLABLE | Deal Score (0–100) computed at time of recording |
| `is_pricing_error` | INTEGER | NOT NULL DEFAULT 0 | 1 if point was flagged as error (excluded from analytics) |
| `recorded_at` | TEXT | NOT NULL | ISO 8601 recording timestamp |

### 2.9 Steam Assets (`steam_assets`)
Cached high-resolution artwork and graphics.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `steam_app_id` | INTEGER | NOT NULL | Steam Application ID |
| `asset_type` | TEXT | NOT NULL | `header`, `capsule`, `hero`, `logo` |
| `asset_url` | TEXT | NOT NULL | Remote CDN URL |
| `local_path` | TEXT | NULLABLE | Cached file path |
| `last_updated_at` | TEXT | NOT NULL | Timestamp of asset retrieval |

### 2.10 Family Owned Apps (`family_owned_apps`)
Tracks Steam Family Library Sharing ownership.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `profile_id` | TEXT | NOT NULL REFERENCES profiles(id) | Family member profile |
| `steam_app_id` | INTEGER | NOT NULL | Steam App ID owned by family member |
| `synced_at` | TEXT | NOT NULL | Timestamp of ownership sync |

### 2.11 Notifications Log (`notifications_log`)
Prevents redundant Discord alert spam.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Notification log UUID |
| `game_id` | TEXT | NOT NULL REFERENCES games(id) | Associated game |
| `channel` | TEXT | NOT NULL DEFAULT 'discord' | Alert channel |
| `price_eur` | REAL | NOT NULL | Deal price at alert time |
| `deal_score` | INTEGER | NOT NULL | Deal Score at alert time |
| `sent_at` | TEXT | NOT NULL | Timestamp of dispatch |

---

## 3. Database Indexes & Query Optimizations

Key composite and filtered indexes designed for 2,000+ item catalog queries:
- `idx_offers_game_valid_price`: `offers(game_id, is_valid, price_eur)` — Powers fast best-deal resolution.
- `idx_offers_best_valid`: `offers(game_id, is_valid, is_best_deal)` — Instant retrieval of active best deals.
- `idx_offers_pricing_error`: `offers(is_likely_pricing_error)` — Separates pricing errors in queries.
- `idx_pricing_errors_game`: `pricing_errors(game_id)` — Rapid lookup of active game glitches.
- `idx_price_history_game`: `price_history(game_id, recorded_at)` — Fast timeline retrieval for SVG charts.
- `idx_price_history_reliable`: `price_history(game_id, is_pricing_error)` — Excludes errors from period lows.
- `idx_wishlist_active_priority`: `wishlist_entries(is_active, profile_id, priority)` — Powers sorted wishlist views.
- `idx_family_owned_apps_app_id`: `family_owned_apps(steam_app_id)` — Fast `NOT EXISTS` check for `hideFamilyShared`.

---

## 4. Migration History (001–027)

Managed via `src/server/db/migrations.ts`:
- **001–007**: Initial schema setup (risk levels, anomaly flags, statistical deal score columns, allkeyshop pacing, target prices).
- **008–016**: Data cleanups, composite indexes, notifications log, family sharing ownership.
- **017**: Added `steamdb_rating`, `metacritic_score`, and `metacritic_url` to `games`.
- **018–021**: Source priority columns, notification logs, and query fixes.
- **022**: Dedicated `pricing_errors` table, added pricing error columns to `offers`, created `steam_assets` table, dropped legacy anomaly columns.
- **023**: Dropped legacy artificial `trust_score` from `merchants`.
- **024**: Created composite indexes (`idx_offers_pricing_error`, `idx_price_history_reliable`) and backward-compatible `anomalies` view with `INSTEAD OF` triggers.
- **025**: Added `is_delisted` column to `games`.
- **026**: Dismissed false sub-euro glitches on offers $\ge 1.005\text{ €}$, unflagged offers, and recomputed best deals.
- **027**: Created `family_sharing_exclusions` table and `idx_family_sharing_exclusions_app_id` index to track Steam-restricted unshareable titles.
- **028**: Added composite performance indexes (`idx_wishlist_profile_active_priority`, `idx_offers_game_valid_error_price`) and exchange rate audit columns to `source_observations` (`fx_rate`, `fx_rate_timestamp`).
- **029**: Added user feedback loop columns (`user_feedback`, `feedback_at`) and index `idx_pricing_errors_feedback` to `pricing_errors`.
- **030**: Created `purchases` table and indexes (`idx_purchases_profile_date`, `idx_purchases_game`) for the Purchase Journal & Realized Savings Tracker.
- **031**: High-performance composite indexes (`idx_sync_runs_started_at`, `idx_pricing_errors_offer`, `idx_pricing_errors_game_dismissed`, `idx_price_history_recorded_at`, `idx_price_history_game_merchant`, `idx_offers_game_best_deal`) and best deal recomputation write minimization.
