# Domain Data Model

This document outlines the database schema, entity relationships, normalization strategies, and data lifecycle for **Pricetool** (v2.7.0).

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
                                │   Observed At, FX)    │          │ Valid, │ │   │ Hero Artwork)    │
                                └───────────▲───────────┘          │ Error) │ │   └──────────────────┘
                                            │*                     └───┬────┘ │
┌────────────────────┐          ┌───────────┴───────────┐              │1     │1
│      Merchant      │1        *│        Source         │              │*     │*
│ (Store / Shop,     ├──────────┤(Steam, ITAD, GGDeals, │          ┌───▼──────▼─────────┐
│  is_official flag) │          │ CheapShark, Keyshop)  │          │   PricingError     │
└─────────┬──────────┘          └───────────────────────┘          │ (Error Type, Score,│
          │1                                                       │  Dismissal, Feedback)
          │*                                                       └────────────────────┘
┌─────────▼──────────┐          ┌───────────────────────┐          ┌────────────────────┐
│    PriceHistory    │          │FamilySharingExclusion │          │      Purchase      │
│(Recorded Movement, │          │ (Steam AppID, Reason) │          │(Price, MSRP, Median│
│ Deal Score, Error) │          └───────────────────────┘          │ Savings, Journal)  │
└────────────────────┘                                             └────────────────────┘
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
| `nexarda_id` | INTEGER | NULLABLE | NEXARDA internal product numeric ID |
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
| `official_historical_low_eur` | REAL | NULLABLE | Lowest recorded price in EUR exclusively from official authorized storefronts (Migration 037) |
| `official_historical_low_date` | TEXT | NULLABLE | Timestamp when official store historical low was established |
| `official_historical_low_source` | TEXT | NULLABLE | Official retailer name establishing the low |
| `typical_sale_median_eur` | REAL | NULLABLE | Tukey IQR typical sale median price in EUR |
| `typical_sale_q1_eur` | REAL | NULLABLE | Tukey IQR 25th percentile price in EUR |
| `typical_sale_q3_eur` | REAL | NULLABLE | Tukey IQR 75th percentile price in EUR |
| `typical_sale_sample_count` | INTEGER | NULLABLE | Count of sale price samples used for IQR |
| `typical_sale_low_confidence` | INTEGER | NULLABLE | 1 if $< 5$ samples available |
| `low_90d_eur` | REAL | NULLABLE | Lowest safe price in past 90 days (null if insufficient history) |
| `low_1y_eur` | REAL | NULLABLE | Lowest safe price in past 365 days (null if insufficient history) |
| `atl_is_confirmed` | INTEGER | DEFAULT 1 | 1 if confirmed by official store or multi-peer agreement |
| `atl_is_single_source_low` | INTEGER | DEFAULT 0 | 1 if ATL was reported by single unverified keyshop source |
| `price_tracking_first_observed_at` | TEXT | NULLABLE | First recorded observation timestamp |
| `best_offer_source_count` | INTEGER | NULLABLE | Number of distinct sources corroborating current best deal |
| `deal_score_stats_updated_at` | TEXT | NULLABLE | Timestamp of last statistical recalculation |
| `price_history_seeded_at` | TEXT | NULLABLE | Timestamp of historical price ingestion |
| `allkeyshop_last_checked_at` | TEXT | NULLABLE | Last AllKeyShop enrichment check timestamp |
| `allkeyshop_check_interval_hours` | INTEGER | DEFAULT 24 | Adaptive check interval (24h to 168h ceiling) |
| `allkeyshop_unchanged_streak` | INTEGER | DEFAULT 0 | Consecutive runs with unchanged keyshop price |
| `allkeyshop_last_price_eur` | REAL | NULLABLE | Previous keyshop price for stability tracking |
| `sale_cadence` | TEXT | DEFAULT 'STANDARD_CADENCE' | Discount frequency classification (`RARE_SALE`, `ROUTINE_SALE`, `STANDARD_CADENCE`) (Migration 038) |
| `avg_days_between_sales` | INTEGER | NULLABLE | Median days elapsed between promotional discount periods |
| `days_since_last_sale` | INTEGER | NULLABLE | Days elapsed since the last promotional discount concluded |
| `subscription_services` | TEXT | NULLABLE | Comma-separated list of active subscription services carrying the title (`GAME_PASS`, `EA_PLAY`) |
| `steam_review_desc` | TEXT | NULLABLE | Steam review sentiment text (e.g. "Very Positive") |
| `steam_review_percent` | INTEGER | NULLABLE | Steam positive review percentage (0–100) |
| `steam_review_total` | TEXT | NULLABLE | Formatted total review count |
| `steamdb_rating` | REAL | NULLABLE | Bayesian Wilson score rating |
| `metacritic_score` | INTEGER | NULLABLE | Metacritic score (0–100) enriched via CheapShark |
| `metacritic_url` | TEXT | NULLABLE | Metacritic review page URL |
| `created_at` | TEXT | NOT NULL | ISO 8601 creation timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601 update timestamp |

### 2.3 Wishlist Entries (`wishlist_entries`)
Links games to profiles with target price thresholds and user priority.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Internal wishlist entry UUID |
| `profile_id` | TEXT | NOT NULL, FK `profiles(id)` | Profile owner |
| `game_id` | TEXT | NOT NULL, FK `games(id)` | Associated game |
| `priority` | INTEGER | NOT NULL DEFAULT 0 | Steam wishlist order priority |
| `date_added_steam` | TEXT | NULLABLE | Date added on Steam |
| `target_price_eur` | REAL | NULLABLE | User target price alert threshold in EUR |
| `is_active` | INTEGER | NOT NULL DEFAULT 1 | Active tracking status |
| `last_synced_at` | TEXT | NOT NULL | Last synchronization timestamp |

### 2.4 Merchants (`merchants`)
Directory of digital game storefronts and marketplace keyshops.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Internal merchant UUID |
| `code` | TEXT | UNIQUE NOT NULL | Normalized slug (e.g. `steam`, `fanatical`, `kinguin`) |
| `name` | TEXT | NOT NULL | Human-readable store name |
| `default_url` | TEXT | NULLABLE | Store homepage URL |
| `is_official` | INTEGER | NOT NULL DEFAULT 1 | 1 if official retailer, 0 if grey-market keyshop |
| `created_at` | TEXT | NOT NULL | ISO 8601 creation timestamp |

### 2.5 Offers (`offers`)
Canonical active deal listings deduplicated across all sources.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Canonical offer UUID |
| `game_id` | TEXT | NOT NULL, FK `games(id)` | Target game |
| `merchant_id` | TEXT | NOT NULL, FK `merchants(id)` | Offering store |
| `product_type` | TEXT | NOT NULL | `STEAM_KEY`, `STEAM_GIFT`, `DIRECT_PURCHASE` |
| `region_type` | TEXT | NOT NULL | `GLOBAL`, `EU`, `HU`, `RESTRICTED` |
| `region_code` | TEXT | NULLABLE | Country code if restricted |
| `region_confidence`| REAL | NOT NULL DEFAULT 1.0 | Activation region certainty |
| `price_eur` | REAL | NOT NULL | Normalized EUR price |
| `original_price_eur`| REAL | NULLABLE | Claimed base price before discount |
| `raw_price` | REAL | NULLABLE | Source native price before FX conversion |
| `raw_currency` | TEXT | DEFAULT 'EUR' | Source currency (`USD`, `GBP`, `HUF`) |
| `raw_original_price`| REAL | NULLABLE | Raw source original price |
| `discount_percent` | INTEGER | NOT NULL DEFAULT 0 | Discount percentage (0–100) |
| `voucher_code` | TEXT | NULLABLE | Promotional coupon code |
| `deal_url` | TEXT | NOT NULL | Direct product purchase link |
| `is_best_deal` | INTEGER | NOT NULL DEFAULT 0 | 1 if currently selected best deal for game |
| `is_valid` | INTEGER | NOT NULL DEFAULT 1 | 1 if active, valid, and within TTL |
| `price_event` | TEXT | NOT NULL DEFAULT 'NONE' | Market classification (`RECORD_DROP`, etc.) |
| `is_likely_pricing_error`| INTEGER | NOT NULL DEFAULT 0 | 1 if quarantined by pricing error engine |
| `pricing_error_confidence`| REAL | NOT NULL DEFAULT 0.0 | Confidence level of detected error |
| `pricing_error_type`| TEXT | NULLABLE | Canonical error category |
| `pricing_error_reason`| TEXT | NULLABLE | Human-readable error description |
| `fetched_at` | TEXT | NOT NULL | Initial fetch timestamp |
| `last_observed_at` | TEXT | NULLABLE | Most recent observation timestamp |
| `created_at` | TEXT | NOT NULL | ISO 8601 creation timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601 update timestamp |

### 2.6 Source Observations (`source_observations`)
Granular provenance tracking multi-adapter sightings of canonical offers.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Observation UUID |
| `offer_id` | TEXT | NOT NULL, FK `offers(id)` | Linked canonical offer |
| `source_code` | TEXT | NOT NULL | Adapter code (`steam`, `itad`, `cheapshark`, `ggdeals`, `allkeyshop`) |
| `observed_price_eur`| REAL | NOT NULL | Price reported by this specific adapter |
| `observed_raw_price`| REAL | NULLABLE | Raw native price reported |
| `observed_currency` | TEXT | DEFAULT 'EUR' | Currency reported |
| `observed_at` | TEXT | NOT NULL | Observation timestamp |
| `raw_data_json` | TEXT | NULLABLE | Raw JSON response payload |
| `fx_rate` | REAL | DEFAULT 1.0 | Exchange rate used at observation time |
| `fx_rate_timestamp` | TEXT | NULLABLE | Timestamp of FX rate retrieval |

### 2.7 Price History (`price_history`)
Immutable audit log capturing historical price movements and Deal Scores.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Record UUID |
| `game_id` | TEXT | NOT NULL, FK `games(id)` | Associated game |
| `merchant_id` | TEXT | NOT NULL, FK `merchants(id)` | Store offering price |
| `source_code` | TEXT | NOT NULL | Adapter recording price |
| `price_eur` | REAL | NOT NULL | Historical price in EUR |
| `raw_price` | REAL | NULLABLE | Native currency amount |
| `raw_currency` | TEXT | DEFAULT 'EUR' | Native currency code |
| `fx_rate` | REAL | DEFAULT 1.0 | Historical FX conversion multiplier |
| `discount_percent` | INTEGER | NULLABLE | Recorded discount percentage |
| `price_event` | TEXT | NULLABLE | Event classification at time of record |
| `deal_score` | INTEGER | NULLABLE | Computed Deal Score (0–100) |
| `is_pricing_error` | INTEGER | NOT NULL DEFAULT 0 | 1 if movement was evaluated as an error |
| `recorded_at` | TEXT | NOT NULL | ISO 8601 snapshot timestamp |

### 2.8 Sources Metadata (`sources`)
Adapter operational status, circuit breaker state, and failure telemetry.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Source UUID |
| `code` | TEXT | UNIQUE NOT NULL | Unique adapter code |
| `name` | TEXT | NOT NULL | Display name |
| `is_enabled` | INTEGER | NOT NULL DEFAULT 1 | Master enable/disable toggle |
| `priority` | INTEGER | NOT NULL DEFAULT 10 | Sync execution priority |
| `state` | TEXT | NOT NULL DEFAULT 'NORMAL' | `NORMAL`, `BACKOFF`, `PAUSED`, `COOLDOWN` |
| `request_count` | INTEGER | NOT NULL DEFAULT 0 | Lifetime HTTP requests |
| `success_count` | INTEGER | NOT NULL DEFAULT 0 | Successful responses |
| `failure_count` | INTEGER | NOT NULL DEFAULT 0 | Network or HTTP errors |
| `rate_limit_count` | INTEGER | NOT NULL DEFAULT 0 | 429 rate limit occurrences |
| `consecutive_failures`| INTEGER | NOT NULL DEFAULT 0 | Current unbroken failure streak |
| `consecutive_rate_limits`| INTEGER | NOT NULL DEFAULT 0 | Current unbroken 429 streak |
| `last_success_at` | TEXT | NULLABLE | Last successful fetch timestamp |
| `last_error` | TEXT | NULLABLE | Error note (clears automatically on success) |
| `cooldown_until` | TEXT | NULLABLE | ISO timestamp until requests unblock |
| `created_at` | TEXT | NOT NULL | Creation timestamp |
| `updated_at` | TEXT | NOT NULL | Update timestamp |

### 2.9 Sync Runs (`sync_runs`)
Tracks execution metrics and outcomes per synchronization run.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Sync run UUID |
| `trigger_type` | TEXT | NOT NULL DEFAULT 'MANUAL' | `MANUAL`, `SCHEDULED`, `STARTUP` |
| `status` | TEXT | NOT NULL DEFAULT 'RUNNING' | `RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED` |
| `started_at` | TEXT | NOT NULL | Sync start timestamp |
| `completed_at` | TEXT | NULLABLE | Sync completion timestamp |
| `total_games` | INTEGER | NOT NULL DEFAULT 0 | Games scheduled for sync |
| `processed_games` | INTEGER | NOT NULL DEFAULT 0 | Games successfully processed |
| `offers_found` | INTEGER | NOT NULL DEFAULT 0 | Total offers ingested |
| `offers_updated` | INTEGER | NOT NULL DEFAULT 0 | Existing offers refreshed |
| `error_message` | TEXT | NULLABLE | Fatal failure description |

### 2.10 Pricing Errors (`pricing_errors`)
Isolated records of detected price anomalies with user feedback state.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Error record UUID |
| `game_id` | TEXT | NOT NULL, FK `games(id)` | Target game |
| `offer_id` | TEXT | NOT NULL, FK `offers(id)` | Quarantined offer |
| `error_type` | TEXT | NOT NULL | Canonical type (`DECIMAL_SHIFT`, `MARKET_OUTLIER`, etc.) |
| `confidence` | REAL | NOT NULL | Detection confidence (0.0–1.0) |
| `reason` | TEXT | NOT NULL | Human-readable explanation |
| `detected_at` | TEXT | NOT NULL | Detection timestamp |
| `is_dismissed` | INTEGER | NOT NULL DEFAULT 0 | 1 if dismissed automatically or by user |
| `user_feedback` | TEXT | NULLABLE | `TRUE_POSITIVE`, `FALSE_POSITIVE` |
| `feedback_at` | TEXT | NULLABLE | Timestamp when user submitted feedback |

### 2.11 Settings (`settings`)
Key-value application settings storage.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `key` | TEXT | PRIMARY KEY | Configuration key |
| `value` | TEXT | NOT NULL | Serialized JSON or string value |
| `updated_at` | TEXT | NOT NULL | Last update timestamp |

### 2.12 Notifications Log (`notifications_log`)
Outbound notification deduplication and rate-limiting audit log.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Log entry UUID |
| `game_id` | TEXT | NOT NULL, FK `games(id)` | Notified game |
| `channel` | TEXT | NOT NULL DEFAULT 'discord' | Delivery channel |
| `price_eur` | REAL | NOT NULL | Price at notification dispatch |
| `deal_score` | INTEGER | NOT NULL | Deal score at dispatch |
| `sent_at` | TEXT | NOT NULL | Delivery timestamp |

### 2.13 Family Owned Apps (`family_owned_apps`)
Mapping of Steam Family Library owned titles per family profile.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `profile_id` | TEXT | NOT NULL, FK `profiles(id)` | Owning family member profile |
| `steam_app_id` | INTEGER | NOT NULL | Steam App ID owned |
| `synced_at` | TEXT | NOT NULL | Last synchronization timestamp |

### 2.14 Steam Assets (`steam_assets`)
Cached high-resolution Steam Storefront artwork assets.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `steam_app_id` | INTEGER | NOT NULL | Target Steam App ID |
| `asset_type` | TEXT | NOT NULL | `header`, `capsule`, `hero`, `logo` |
| `asset_url` | TEXT | NOT NULL | Remote CDN URL |
| `local_path` | TEXT | NULLABLE | Local cached filesystem path |
| `last_updated_at`| TEXT | NOT NULL | Cache refresh timestamp |

### 2.15 Family Sharing Exclusions (`family_sharing_exclusions`)
Games excluded from Steam Family Sharing due to third-party DRM or publisher restrictions.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `steam_app_id` | INTEGER | PRIMARY KEY | Steam App ID excluded |
| `reason` | TEXT | NULLABLE | Reason tag (e.g. `CATEGORY_62_MISSING`, `EA_PLAY`, `MANUAL`) |
| `created_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Creation timestamp |

### 2.16 Purchases (`purchases`)
Purchase journal tracking bought games with historical baseline snapshots.
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PRIMARY KEY | Purchase record UUID |
| `profile_id` | TEXT | NOT NULL, FK `profiles(id)` | Purchasing profile |
| `game_id` | TEXT | NOT NULL, FK `games(id)` | Purchased game |
| `offer_id` | TEXT | NULLABLE, FK `offers(id)` | Associated offer |
| `merchant_id` | TEXT | NULLABLE, FK `merchants(id)`| Selling merchant |
| `price_eur` | REAL | NOT NULL | Purchase price in EUR |
| `msrp_eur` | REAL | NULLABLE | Historical Steam MSRP at purchase moment |
| `typical_median_eur`| REAL | NULLABLE | Tukey IQR typical sale median at purchase moment |
| `savings_vs_msrp_eur`| REAL | NULLABLE | Absolute savings vs baseline MSRP |
| `savings_vs_median_eur`| REAL | NULLABLE| Absolute savings vs typical historical sale |
| `purchased_at` | TEXT | NOT NULL | Date and time of purchase |
| `notes` | TEXT | NULLABLE | User notes or activation key notes |
| `created_at` | TEXT | NOT NULL | Creation timestamp |

---

## 3. High-Performance Index Topology

To support 2,000+ game wishlists with sub-millisecond query response times, composite indexes eliminate table scans across all critical hot paths:

```sql
-- Wishlist filtering and priority ordering
CREATE INDEX idx_wishlist_profile_active_priority ON wishlist_entries(profile_id, is_active, priority);
CREATE INDEX idx_wishlist_game_id ON wishlist_entries(game_id);

-- Best Deal election & pricing error filtering
CREATE INDEX idx_offers_game_valid_error_price ON offers(game_id, is_valid, is_likely_pricing_error, price_eur);
CREATE INDEX idx_offers_game_valid_anomaly ON offers(game_id, is_valid, is_likely_pricing_error);
CREATE INDEX idx_offers_game_best_deal ON offers(game_id, is_best_deal);

-- Price history timeseries retrieval
CREATE INDEX idx_price_history_game_merchant ON price_history(game_id, merchant_id, is_pricing_error, recorded_at DESC);
CREATE INDEX idx_price_history_recorded_at ON price_history(recorded_at);

-- Family sharing exclusions fast lookup
CREATE INDEX idx_family_sharing_exclusions_app_id ON family_sharing_exclusions(steam_app_id);

-- Purchase journal analytics
CREATE INDEX idx_purchases_profile_date ON purchases(profile_id, purchased_at DESC);
CREATE INDEX idx_purchases_game ON purchases(game_id);

-- Sync run history
CREATE INDEX idx_sync_runs_started_at ON sync_runs(started_at DESC);
```
