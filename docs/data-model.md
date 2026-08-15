# Domain Data Model

This document outlines the database schema, entity relationships, normalization strategies, and data lifecycle for the application.

---

## 1. Entity-Relationship Overview

```text
┌────────────────┐          ┌───────────────────────┐          ┌────────────────┐
│    Profile     │1        *│    WishlistEntry      │*        1│      Game      │
│ (Steam Account)├──────────┤ (Priority, Added Date)├──────────┤ (Steam AppID,  │
└────────────────┘          └───────────────────────┘          │  Title, Media) │
                                                               └───┬────────────┘
                                                                   │1
                                                                   │*
┌────────────────┐          ┌───────────────────────┐          ┌───▼────────────┐
│    Merchant    │1        *│   SourceObservation   │*        1│     Offer      │
│ (Store / Shop) ├──────────┤  (Source, Price, Time)├──────────┤ (Canonical Deal│
└───────┬────────┘          └───────────▲───────────┘          │  Region, Type) │
        │1                               │*                     └───┬────────────┘
        │*                  ┌───────────┴───────────┐               │1
┌───────▼────────┐          │        Source         │               │*
│  PriceHistory  │          │(ITAD, GGDeals, CheapS)│          ┌────▼───────────┐
│ (Recorded Flow)│          └───────────────────────┘          │    Anomaly     │
└────────────────┘                                             │ (Score, Rule)  │
                                                               └────────────────┘
```

---

## 2. Schema Specification (SQLite / Drizzle ORM)

### 2.1 Profiles (`profiles`)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | TEXT (UUID) PK | Internal profile ID |
| `name` | TEXT NOT NULL | Display name (e.g. "Primary Steam Wishlist") |
| `steam_id` | TEXT UNIQUE | 64-bit Steam ID (e.g. "76561198012345678") |
| `custom_url` | TEXT | Vanity URL slug if configured |
| `avatar_url` | TEXT | Steam profile avatar |
| `is_active` | INTEGER DEFAULT 1 | Active selection in UI |
| `created_at` | DATETIME | Record creation timestamp |
| `updated_at` | DATETIME | Record update timestamp |

### 2.2 Games (`games`)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | TEXT (UUID) PK | Canonical game identifier |
| `steam_app_id` | INTEGER UNIQUE | Steam Application ID (Primary match key) |
| `itad_id` | TEXT | IsThereAnyDeal internal UUID for batch lookup |
| `title` | TEXT NOT NULL | Standard game title |
| `slug` | TEXT NOT NULL | URL-safe name |
| `header_image` | TEXT | Store banner image URL |
| `capsule_image`| TEXT | Small thumbnail image URL |
| `release_date` | TEXT | Release date string |
| `is_dlc` | INTEGER DEFAULT 0 | 1 if downloadable content, 0 if main game |
| `is_free` | INTEGER DEFAULT 0 | 1 if free to play |
| `base_price_eur`| REAL | Steam store default MSRP in EUR |
| `historical_low_eur`| REAL | Lowest recorded price in EUR |
| `historical_low_date`| DATETIME | When historical low was established |
| `historical_low_source`| TEXT | Source providing the historical low proof |
| `created_at` | DATETIME | Record creation timestamp |
| `updated_at` | DATETIME | Record update timestamp |

### 2.3 Wishlist Entries (`wishlist_entries`)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | TEXT (UUID) PK | Wishlist item identifier |
| `profile_id` | TEXT FK -> profiles(id) | Associated profile |
| `game_id` | TEXT FK -> games(id) | Associated game |
| `priority` | INTEGER DEFAULT 0 | Priority ranking in Steam Wishlist |
| `date_added_steam`| DATETIME | When added to Steam Wishlist |
| `is_active` | INTEGER DEFAULT 1 | Whether still present in latest sync |
| `last_synced_at`| DATETIME | Last synchronization run timestamp |

### 2.4 Merchants (`merchants`)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | TEXT (UUID) PK | Merchant identifier |
| `code` | TEXT UNIQUE | Canonical merchant key (e.g. `steam`, `fanatical`, `k4g`, `kinguin`) |
| `name` | TEXT NOT NULL | Display name (e.g. "Fanatical", "K4G") |
| `default_url` | TEXT | Store base URL |
| `is_official` | INTEGER DEFAULT 1 | 1 for official authorized retailers, 0 for keyshops |
| `trust_score` | REAL DEFAULT 1.0 | Reliability weighting (0.0 to 1.0) |

### 2.5 Offers (`offers`)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | TEXT (UUID) PK | Unique Offer ID |
| `game_id` | TEXT FK -> games(id) | Target game |
| `merchant_id` | TEXT FK -> merchants(id) | Selling store |
| `product_type`| TEXT NOT NULL | `STEAM_KEY`, `STEAM_GIFT`, `DIRECT_PURCHASE` |
| `region_type` | TEXT NOT NULL | `GLOBAL`, `EU`, `HU`, `RESTRICTED` |
| `region_code` | TEXT | Specific ISO region or `WW`/`EU` |
| `region_confidence`| REAL DEFAULT 1.0 | 0.0 - 1.0 region compatibility score |
| `price_eur` | REAL NOT NULL | Current purchase price in EUR |
| `original_price_eur`| REAL | Base price before discount in EUR |
| `discount_percent`| INTEGER DEFAULT 0 | Calculated discount percentage |
| `voucher_code`| TEXT | Coupon code if publicly available |
| `deal_url` | TEXT NOT NULL | Direct offer redirect link |
| `is_best_deal`| INTEGER DEFAULT 0 | 1 if current best valid offer for game |
| `is_valid` | INTEGER DEFAULT 1 | 1 if valid, 0 if filtered (e.g. wrong region/account) |
| `is_anomaly` | INTEGER DEFAULT 0 | 1 if flagged as possible price error |
| `anomaly_score`| REAL DEFAULT 0.0 | Calculated anomaly score |
| `fetched_at` | DATETIME NOT NULL | Observation timestamp |

### 2.6 Source Observations (`source_observations`)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | TEXT (UUID) PK | Observation ID |
| `offer_id` | TEXT FK -> offers(id) | Canonical offer |
| `source_code` | TEXT NOT NULL | `itad`, `ggdeals`, `cheapshark`, `allkeyshop`, `gocdkeys` |
| `observed_price_eur`| REAL NOT NULL | Price as reported by this specific source |
| `observed_at` | DATETIME NOT NULL | Timestamp of observation |
| `raw_data_json`| TEXT | Truncated debug payload |

### 2.7 Price History (`price_history`)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | TEXT (UUID) PK | History entry ID |
| `game_id` | TEXT FK -> games(id) | Game reference |
| `merchant_id` | TEXT FK -> merchants(id) | Merchant reference |
| `source_code` | TEXT NOT NULL | Source code |
| `price_eur` | REAL NOT NULL | Price in EUR |
| `discount_percent`| INTEGER | Discount percentage |
| `recorded_at` | DATETIME NOT NULL | Timestamp |

### 2.8 Sync Runs & Jobs (`sync_runs`, `sync_jobs`)
* Tracks synchronization sessions, duration, per-source progress, request counters, 429 rates, and errors.

### 2.9 Anomalies (`anomalies`)
* Records detected price anomalies, rule violation triggers, and user dismissal actions.

---

## 3. Deduplication Logic

Unique constraint on active offers: `UNIQUE(game_id, merchant_id, product_type, region_type)`

When Source A and Source B both report an offer for the same `(game_id, merchant_id, product_type, region_type)`:
1. The canonical `offers` record is updated with the freshest price (or lowest if observed within the same sync cycle).
2. Separate `source_observations` records are created for both Source A and Source B.
3. The UI indicates multi-source verification (`Verified by ITAD + GG.deals`).
