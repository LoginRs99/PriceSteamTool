# API Data Matrix & Request Capabilities

> **Technical Reference for Price Aggregators & Metadata Sources in Pricetool**  
> This reference documents what data fields can be requested, what query parameters & filters are supported, rate limits, batching mechanisms, and how each source is mapped into Pricetool's database.

---

## 1. Quick Capabilities Matrix

| Feature / Dimension | Steam Storefront & Web API | IsThereAnyDeal (ITAD v2/v3) | GG.deals API | CheapShark REST API | AllKeyShop (Internal API) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Official Public API** | Undocumented Web API + Partner API | ✅ Yes (REST v2/v3) | ✅ Yes (REST v1) | ✅ Yes (REST v1.0) | ❌ No (Internal JSON) |
| **API Key Required** | Optional (`STEAM_API_KEY`) | ✅ Yes (`ITAD_API_KEY`) | ✅ Yes (`GGDEALS_API_KEY`) | ❌ None required | ❌ None (Requires Solver) |
| **Batch Query Support** | Wishlist: 200 items/page | 150–200 games / request | 100 AppIDs / request | 25 AppIDs / request | Per-game adaptive queue |
| **Rate Limit / Pacing** | 2,000 ms (250 ms jitter) | 1,000 ms (200 ms jitter) | 100 req/min (1,500 ms) | 1,500 ms (250 ms jitter) | 2,500 ms (500 ms jitter) |
| **Bot Protection / WAF** | IP Rate Limits | Cloudflare / Token | Cloudflare / API Key | Standard HTTP User-Agent | Cloudflare / Turnstile (FlareSolverr/Byparr) |
| **Store Type Coverage** | Steam Direct Store only | 40+ Official Stores | Official + Marketplace | 25+ Official Stores | 30+ Keyshop Marketplaces |
| **Historical Lows** | ❌ No (Current price only) | ✅ Yes (`historyLow`) | ✅ Yes (`historicalRetail` / `historicalKeyshops`) | ✅ Yes (`cheapestPriceEver`) | ✅ Yes (`min_price`, history graph) |
| **MSRP / Base Price** | ✅ Yes (Canonical) | ✅ Yes (`regular`) | ❌ No | ✅ Yes (`retailPrice`) | ✅ Yes (`originalPrice`) |
| **Review Scores** | ✅ Yes (SteamDB + Steam) | ❌ No | ❌ No | ✅ Yes (Metacritic score/url) | ❌ No |
| **Voucher / Promo Codes** | ❌ No | ❌ No | ❌ No | ❌ No | ✅ Yes (`voucher_code`) |
| **Buyer Fees (Card/PayPal)** | ❌ None | ❌ None | ❌ None | ❌ None | ✅ Yes (`priceCard`, `pricePaypal`) |

---

## 2. Granular Data Extraction by Source

### 2.1 Steam Storefront & Wishlist Web API
The canonical source of truth for user wishlist entries, baseline pricing, and game metadata.

* **Primary Endpoints**:
  - `GET https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid={steamId64}`
  - Fallback: `GET https://store.steampowered.com/wishlist/profiles/{steamId64}/wishlistdata/?p={page}`
  - Store details: `GET https://store.steampowered.com/api/appdetails?appids={appId}&cc={country}&filters=basic,price_overview,categories`
* **Query Parameters & Filters**:
  - `cc` (Country / Currency code, e.g. `hu`, `de`, `us`)
  - `filters` (`basic,price_overview,categories`)
  - `p` (Page index for HTML wishlist fallback)
* **What Data is Extracted**:
  - `steamAppId` (Canonical game identifier)
  - `title` (Canonical English or localized game title)
  - `priority` (User's wishlist order)
  - `dateAdded` (When added to wishlist)
  - `isDlc`, `isFree` (DLC and Free-to-Play classification)
  - `rawPrice`, `basePriceEur`, `currentPriceEur`, `discountPercent` (Store MSRP & active discount)
  - `headerImage`, `capsuleImage` (Game artwork CDN URLs)
  - `releaseDate` (Release date string)
  - `reviewDesc`, `reviewsPercent`, `reviewsTotal` (Steam customer review ratings)
  - `steamdbRating` (Wilson Score rating calculated from positive/negative review counts)
  - `categories` (Category 62: Family Sharing compatibility indicator)

---

### 2.2 IsThereAnyDeal (ITAD REST API v2 / v3)
Primary verified aggregator for 40+ official authorized digital storefronts.

* **Primary Endpoints**:
  - `GET https://api.isthereanydeal.com/games/lookup/v1?key={API_KEY}&appid={steamAppId}`
  - `POST https://api.isthereanydeal.com/games/prices/v3?key={API_KEY}&country={ISO_ALPHA2}`
  - `POST https://api.isthereanydeal.com/games/overview/v2?key={API_KEY}&country={ISO_ALPHA2}`
  - `GET https://api.isthereanydeal.com/games/history/v2?key={API_KEY}&id={itadId}&country={ISO_ALPHA2}&since={ISO8601}`
* **Query Parameters & Filters**:
  - `key` (ITAD API key)
  - `country` (Mandatory ISO 3166-1 alpha-2, e.g. `HU`, `DE`, `US`, `GB` — 'EU' is rejected)
  - `since` (ISO 8601 timestamp for historical windowing)
  - Payload in `POST`: Array of ITAD Game UUIDs (max 200 per request)
  - Optional ITAD filters: `shops` (comma-separated shop IDs), `capacity`
* **What Data is Extracted**:
  - `itadId` (Canonical ITAD game UUID)
  - `merchantCode`, `merchantName` (Humble, Fanatical, GOG, Steam, Green Man Gaming, etc.)
  - `isOfficial` (`true` for official authorized retailers; proprietary launcher stores flagged)
  - `priceEur`, `rawPrice`, `rawCurrency` (Store deal price normalized to EUR)
  - `rawOriginalPrice`, `discountPercent`
  - `dealUrl` (Affiliate / store deal link)
  - `productType` (`Steam Key`, `Direct Purchase`, or `Non-Steam`)
  - `historicalLowEur`, `historicalLowDate` (All-time recorded low across authorized stores)
  - `history` points (Price movement array: timestamp, price, store)

---

### 2.3 GG.deals (API v1)
High-level aggregator for official retailers and curated marketplace keyshops.

* **Primary Endpoints**:
  - `GET https://api.gg.deals/v1/prices/by-steam-app-id/?ids={appIds}&key={API_KEY}&region={region}`
* **Query Parameters & Filters**:
  - `ids` (Comma-separated Steam App IDs, max 100 per request)
  - `key` (GG.deals developer API key)
  - `region` (`eu`, `us`, `uk`, `global`)
* **What Data is Extracted**:
  - `currentRetail` (Lowest price among all official stores)
  - `historicalRetail` (All-time low among official stores)
  - `currentKeyshops` (Lowest price among keyshops)
  - `historicalKeyshops` (All-time low among keyshops)
  - `currency` (`EUR`, `USD`, `GBP`)
  - `url` (Direct game page link on GG.deals)
* **Architectural Constraint**:
  - GG.deals returns pre-aggregated buckets rather than individual shops. Pricetool models GG.deals as exactly two canonical merchants:
    1. `GG.deals (Official)` (`merchantCode: 'ggdeals_retail'`, `isOfficial: true`)
    2. `GG.deals (Keyshops)` (`merchantCode: 'ggdeals_keyshops'`, `isOfficial: false`)
  - Enables cross-source family conflict detection (`SOURCE_FAMILY_CONFLICT`) if official vs keyshop price deviates $\ge 2.0\times$.

---

### 2.4 CheapShark (Public REST API v1.0)
Fast, keyless official store batch verification and Metacritic metadata provider.

* **Primary Endpoints**:
  - Store list: `GET https://www.cheapshark.com/api/1.0/stores`
  - Deals batch: `GET https://www.cheapshark.com/api/1.0/deals?steamAppID={appIds}&pageSize=60&pageNumber={page}`
  - Single game deals: `GET https://www.cheapshark.com/api/1.0/deals?steamAppID={appId}`
  - Historical low: `GET https://www.cheapshark.com/api/1.0/games?id={cheapSharkGameId}`
* **Query Parameters & Filters**:
  - `steamAppID` (Up to 25 comma-separated Steam App IDs per batch)
  - `storeID` (Optional filter by store IDs, e.g. 1 for Steam, 7 for GOG, 11 for Humble)
  - `pageSize` (Max 60 results per page)
  - `pageNumber` (0-indexed pagination)
  - `lowerPrice`, `upperPrice` (Optional numeric price filters)
  - `metacritic` (Filter by minimum Metacritic score)
* **What Data is Extracted**:
  - `merchantName`, `merchantCode` (Fanatical, GamersGate, GreenManGaming, Steam, Humble Store, etc.)
  - `priceEur`, `rawPrice` (Sale price converted from USD to EUR)
  - `originalPriceEur` (Retail MSRP)
  - `dealUrl` (Direct store deal link)
  - `metacriticScore`, `metacriticUrl` (Metacritic rating and review slug)
  - `cheapestPriceEver` (Historical low price and unix timestamp)

---

### 2.5 AllKeyShop (Internal API via Solver)
Comprehensive marketplace keyshop intelligence (Eneba, Kinguin, CDKeys, Instant Gaming, Gamivo, etc.).

* **Primary Endpoints (Routed through Byparr / FlareSolverr)**:
  - Game details & live offers: `https://www.allkeyshop.com/api/v2/vaks.php?action=gamePageTrans&id={aksGameId}&currency=eur`
  - Historical prices: `https://www.allkeyshop.com/api/v2/price_history_api.php?id={aksGameId}&currency=eur`
  - Catalog index: `https://www.allkeyshop.com/api/v2/vaks.php?action=gameNames&v=2&currency=eur&locales=en_GB`
* **Query Parameters & Filters**:
  - `id` (AllKeyShop internal game ID)
  - `currency` (`eur`)
  - `locales` (`en_GB`)
* **What Data is Extracted**:
  - `merchantName`, `merchantCode` (Kinguin, Eneba, G2A, CDKeys, Gamivo, Instant Gaming, Driffle, etc.)
  - `isOfficial` (`false` for marketplace keyshops, `true` for official stores listed)
  - `price` (Raw bare catalog price before fees)
  - `priceCard` (Real user-facing price **including credit card / payment gateway fees** — used in Pricetool)
  - `pricePaypal` (Price including PayPal surcharges)
  - `voucherCode` (Discount code offering extra 3–15% off)
  - `editionName` (Standard, Deluxe, Gold, etc.)
  - `regionName` (`GLOBAL`, `EU`, `ROW`)
  - `activationPlatform` (Filtered strictly to `Steam`)

---

## 3. Storage & Domain Mapping in Pricetool

All received external data flows into the following normalized SQLite database structures:

```
┌─────────────────┐       ┌─────────────────┐       ┌────────────────────────┐
│      games      │       │     offers      │       │  source_observations   │
├─────────────────┤       ├─────────────────┤       ├────────────────────────┤
│ id              │◄──┐   │ id              │◄──┐   │ id                     │
│ steam_app_id    │   └───┤ game_id         │   └───┤ offer_id               │
│ itad_id         │       │ merchant_id     │       │ source_code            │
│ title           │       │ price_eur       │       │ raw_price              │
│ base_price_eur  │       │ voucher_code    │       │ raw_currency           │
│ historical_low  │       │ is_official     │       │ observed_at            │
│ metacritic_score│       │ deal_url        │       └────────────────────────┘
│ steamdb_rating  │       │ is_best_deal    │
└─────────────────┘       └─────────────────┘
```

1. **`games`**: Stores canonical titles, MSRP anchor, lowest recorded historical prices, and review scores.
2. **`offers`**: Unique active price points per game and merchant, with verified voucher codes and fees.
3. **`source_observations`**: Corroboration records proving which adapter (or multiple adapters) observed the price.
4. **`price_history`**: Historical timeline points powering Deal Score v2.4 and purchase timing advice.
5. **`pricing_errors`**: Suspected glitches, sub-euro errors, and extreme anomalies quarantined from Deal Score calculation.
