# API Data Matrix & Request Capabilities

> **Technical Reference for Price Aggregators & Metadata Sources in Pricetool**  
> This reference documents what data fields can be requested, what query parameters & filters are supported, rate limits, batching mechanisms, and how each source is mapped into Pricetool's database.

---

## 1. Quick Capabilities Matrix

| Feature / Dimension | Steam Storefront | IsThereAnyDeal (ITAD) | CheapShark | GG.deals | NEXARDA™ | SuperDuperBundle | *AllKeyShop (Retired)* |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Official Public API** | Undocumented Web API | ✅ Yes (REST v2/v3) | ✅ Yes (REST v1.0) | ✅ Yes (REST v1) | ✅ Yes (REST v3) | ✅ Yes (REST v1) | ❌ No (Internal JSON) |
| **API Key Required** | Optional (`STEAM_API_KEY`) | ✅ Yes (`ITAD_API_KEY`) | ❌ None required | ✅ Yes (`GGDEALS_API_KEY`) | ❌ None required | Optional (`X-API-Key`) | ❌ None (Requires Solver) |
| **Batch Query Support** | Wishlist: 200 items/page | 150–200 games / request | 25 AppIDs / request | 100 AppIDs / request | Per-game find & search | 50 AppIDs / request | Per-game queue |
| **Rate Limit / Pacing** | 2,000 ms (250 ms jitter) | 1,000 ms (200 ms jitter) | 1,500 ms (250 ms jitter) | 100 req/min (1,500 ms) | 500 ms (100 ms jitter) | 1,000 ms (200 ms jitter) | 2,500 ms (500 ms jitter) |
| **Bot Protection / WAF** | IP Rate Limits | Cloudflare / Token | Standard User-Agent | Cloudflare / API Key | Standard / Retry-After | Quota headers | FlareSolverr/Byparr |
| **Store Type Coverage** | Steam Direct Store | 40+ Official Stores | 25+ Official Stores | Official + Marketplace | 20+ Official & Keyshops | Keyshop & Bundle Stores | 30+ Keyshops |
| **Historical Lows** | ❌ No | ✅ Yes (`historyLow`) | ✅ Yes (`cheapestPriceEver`) | ✅ Yes (Retail & Keyshop) | ✅ Yes (`lowest_price`) | ❌ No (Current prices) | ✅ Yes (History graph) |
| **MSRP / Base Price** | ✅ Yes (Canonical) | ✅ Yes (`regular`) | ✅ Yes (`retailPrice`) | ❌ No | ✅ Yes | ❌ No | ✅ Yes (`originalPrice`) |
| **Review Scores** | ✅ Yes (SteamDB + Steam) | ❌ No | ✅ Yes (Metacritic) | ❌ No | ❌ No | ❌ No | ❌ No |
| **Voucher / Promo Codes**| ❌ No | ❌ No | ❌ No | ❌ No | ✅ Yes (Voucher codes) | ✅ Yes (Vouchers) | ✅ Yes (`voucher_code`) |
| **Status in Main** | Active Core | Active Core | Active Core | Active Core | Active Core | Active Core | *Retired in v2.10.1 (backup branch)* |

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

### 2.5 NEXARDA™ API v3
Comprehensive multi-retailer price aggregator covering 20+ verified official and marketplace digital stores.

* **Primary Endpoints**:
  - Direct Steam ID lookup: `GET https://www.nexarda.com/api/v3/find?steam={steamAppId}&output=json`
  - Text search fallback: `GET https://www.nexarda.com/api/v3/search?type=games&q={candidateQuery}`
  - Price & merchant breakdown: `GET https://www.nexarda.com/api/v3/prices?type=game&id={nexardaId}&currency=EUR`
* **Query Parameters & Filters**:
  - `steam` (Steam Application ID)
  - `type` (`game` / `games`)
  - `currency` (`EUR`)
* **What Data is Extracted**:
  - `nexardaId` (NEXARDA canonical product ID)
  - `merchantName`, `merchantCode` (Steam, Fanatical, Instant Gaming, CDKeys, Eneba, Kinguin, Gamivo, etc.)
  - `priceEur`, `rawPrice` (Listing price normalized to EUR)
  - `voucherCode` (Active coupon voucher code)
  - `dealUrl` (Affiliate / direct offer URL)
  - `lowestPrice` (Recorded low price on NEXARDA)

---

### 2.6 SuperDuperBundle (SDB API v1)
High-speed batch aggregator querying multiple Steam AppIDs per request.

* **Primary Endpoints**:
  - Single game lookup: `GET https://superduperbundle.com/api/v1/lookup/?steam_id={appId}&client=pricetool`
  - Bulk batch lookup: `GET https://superduperbundle.com/api/v1/lookup/?steam_ids={id1,id2,...,id50}&client=pricetool`
* **Headers**:
  - `X-API-Key` (Optional registered key for higher quota tiers)
* **What Data is Extracted**:
  - `merchantName`, `merchantCode`
  - `priceEur` (Dynamic currency conversion from native payload currency)
  - `lowestSteamKey` (Lowest steam-compatible key offer fallback)
  - `dealUrl` (Direct store deal link)
  - `voucherCode` (Active promotional codes)

---

### 2.7 AllKeyShop (Retired — Preserved on Backup Branch)
Unofficial JSON scraper and solver-based crawler retired in v2.10.1 in favor of native REST APIs. Preserved in git branch `backup/allkeyshop-full-scraper`.

* **Historical Endpoints (Routed through Byparr / FlareSolverr)**:
  - Game details & live offers: `https://www.allkeyshop.com/api/v2/vaks.php?action=gamePageTrans&id={aksGameId}&currency=eur`
  - Historical prices: `https://www.allkeyshop.com/api/v2/price_history_api.php?id={aksGameId}&currency=eur`
  - Catalog index: `https://www.allkeyshop.com/api/v2/vaks.php?action=gameNames&v=2&currency=eur&locales=en_GB`
* **What Data was Extracted**:
  - `merchantName`, `merchantCode` (Kinguin, Eneba, G2A, CDKeys, Gamivo, Instant Gaming, Driffle, etc.)
  - `isOfficial` (`false` for marketplace keyshops, `true` for official stores listed)
  - `price` (Raw bare catalog price before fees)
  - `priceCard` (Real user-facing price including payment gateway fees)
  - `pricePaypal` (Price including PayPal surcharges)
  - `voucherCode` (Discount code offering extra 3–15% off)

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
