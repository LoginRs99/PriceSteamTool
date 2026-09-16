# Pricetool User & Intelligence Guide

This guide explains how **Pricetool** evaluates game discounts, calculates deal quality, detects pricing errors, and generates actionable purchase advice (v2.4.0).

---

## 1. 2D Pricing Engine Concepts

Pricetool separates **price magnitude** from **data reliability and error risk**. A massive discount from an unverified store is evaluated differently from an official publisher sale.

### 1.1 Price Events
Identifies the market significance of a price change relative to Steam MSRP and historical records:
* **`NEW_HISTORICAL_LOW` / `RECORD_DROP`**: The price has dropped below the confirmed All-Time Low, corroborated by verified stores or multi-source agreement.
* **`AT_HISTORICAL_LOW`**: The price matches the confirmed All-Time Low ($\pm 2\%$).
* **`NEAR_HISTORICAL_LOW`**: The price is within $10\%$ of the All-Time Low.
* **`EXTREME_DROP`**: $\ge 75\%$ discount or $\ge 25\text{ €}$ absolute drop on higher-value games ($MSRP \ge 30\text{ €}$).
* **`MAJOR_DROP`**: $\ge 50\%$ discount with $\ge 15\text{ €}$ absolute savings.
* **`SIGNIFICANT_DROP`**: $\ge 30\%$ discount or $\ge 10\text{ €}$ absolute savings.
* **`MODERATE_DROP`**: Standard sale ($\ge 10\%$ discount).
* **`PRICE_INCREASE`**: Price is higher than the previous observation.
* **`PRICING_ERROR`**: Flagged as a pricing glitch or typo.

### 1.2 Pricing Error Engine & Data Safety
Suspected glitches are evaluated by `src/server/domain/pricingError/detector.ts` and isolated into `pricing_errors`:
* **`DECIMAL_SHIFT`**: Sub-euro glitches ($\le 1.005\text{ €}$) on titles with MSRP $\ge 10\text{ €}$, missing digit shifts ($\sim 1/10$ or $\sim 1/100$ of MSRP on MSRP $\ge 30\text{ €}$), or extreme drops ($\le 3\%$ on MSRP $\ge 15\text{ €}$).
* **`SOURCE_FAMILY_CONFLICT`**: Severe intra-family price split ($\ge 2.0\times$) between official stores and marketplace keyshops under the same aggregator source.
* **`OVER_MSRP`**: Informational indicator signaling when an offer exceeds official Steam baseline MSRP.
* **`MARKET_OUTLIER`**: Lone store $> 50\%$ below single peer or $> 75\%$ below multi-peer median (unless at or above confirmed ATL).
* **`BELOW_ATL_IMPLAUSIBLE`**: Price $> 50\%$ below established confirmed ATL.
* **`OWN_HISTORY_BREAK`**: Sudden price collapse vs merchant's own historical median ($z > 2.5$).
* **`FRESH_RELEASE_DROP`**: $> 40\%$ drop on games released $< 30$ days ago without publisher confirmation.
* **`EDITION_INVERSION`**: Deluxe/Gold edition cheaper than base game by $> 30\%$.
* **`FAKE_DISCOUNT`**: Claimed original price $> 1.5\times$ base MSRP.
* **Independent Corroboration**: When $\ge 2$ independent fresh peer prices match within $\pm 40\%$, error flags are overridden (`SUB_EURO_PREMIUM_GLITCH_CORROBORATED`).
* **Automated Self-Healing**: Dismisses errors automatically when prices rise or when cheaper valid deals exist. Flagged offers are excluded from best deal calculations.

---

## 2. Computed Deal Score v2.4 (0 – 100)

The **Deal Score v2.3** provides an objective, monotonic mathematical evaluation of deal attractiveness across 4 pillars:

$$\text{RawScore} = S_{\text{atl}} (0\text{--}40) + S_{\text{disc}} (0\text{--}30) + S_{\text{hist}} (0\text{--}20) + S_{\text{mkt}} (0\text{--}10)$$

### 2.1 The 4 Pillars

1. **$S_{\text{atl}}$ (Proximity to All-Time Low, 0–40 pts):**
   * At confirmed ATL ($price = atl$), awards **36 points base**.
   * Undercutting confirmed ATL awards up to **+4 points bonus** (maxing at 20% undercut).
   * Unconfirmed or single-source ATL is penalized by 50% ($S_{\text{atl}} \times 0.5$).
2. **$S_{\text{disc}}$ (Discount Depth, 0–30 pts):**
   * Diminishing-returns power curve:
     $$S_{\text{disc}} = 30 \times \left(\frac{\text{anchor} - \text{price}}{\text{anchor}}\right)^{0.75}$$
   * Differentiates deep cuts without premature saturation at 75% while rewarding healthy 50%–80% sales. Requires $\ge 10\%$ discount.
   * Fake baseline protection ($original > 1.5 \times base$) resets $S_{\text{disc}}$ to 0.
3. **$S_{\text{hist}}$ (Historical Sale Distribution, 0–20 pts):**
   * Measures price position relative to the typical historical sale median ($med$) and ATL ($atl$):
     $$S_{\text{hist}} = 20 \times \left(1 - \frac{price - atl}{med - atl}\right)$$
   * Prices above typical sale median receive 0 points.
4. **$S_{\text{mkt}}$ (Cross-Market Competitiveness, 0–10 pts):**
   * Ranks price within the spread of all fresh peer offers in the market.
   * Single offer from an official store receives a default market confidence score of 7.

### 2.2 Safety Caps & Score Reservations

* **Provisional History Cap:** If $< 5$ historical samples are recorded:
  * Discount $\ge 60\%$: Capped at **80** (or **85** for official store with known MSRP).
  * Has some history: Capped at **65**.
  * No history at all: Capped at **40**.
* **Stale History Cap:** If observations are $> 90$ days old, score is capped at **60**.
* **Score 100 Reservation:** Score is capped at **99** unless the price beats the confirmed ATL by $\ge 5\%$.
* **Pricing Error Cap:** Any active pricing error yields **Score 0**, **Tier Weak**, **Verdict WAIT**.

### 2.3 Score Tiers & Verdicts

| Score Range | Deal Tier | Purchase Verdict | Meaning |
| :--- | :--- | :--- | :--- |
| **80 – 100** | `Exceptional` | `INSTANT_BUY` | Rare buying opportunity (ATL + deep discount + reliable store) |
| **60 – 79** | `Great` | `GREAT_DEAL` | Strong sale well below typical prices |
| **40 – 59** | `Fair` | `FAIR_DEAL` | Standard regular sale price |
| **0 – 39** | `Weak` | `WAIT` | Minor discount, full price, or unverified outlier |
| Price > MSRP | — | `OVERPRICED` | Listing exceeds standard Steam MSRP |

---

## 3. Price Intelligence & Historical Context

### 3.1 Rolling Period Lows
Tracks the lowest observed trusted price across defined time windows:
* **7-Day Low**, **30-Day Low**, **90-Day Low**, **1-Year Low**, and **Confirmed All-Time Low (ATL)**.
* **No Synthetic Assumptions:** If a game has only been tracked for 4 days, 30d/90d/1y lows are explicitly reported as `null`.

### 3.2 Typical Sale Price & Statistical Outlier Fences
Calculates the historical median price during legitimate discount periods ($\ge 15\%$ off):
* **Tukey's IQR Fences:** Filters out unverified glitch observations without truncating valid 80–90% publisher promotions.
* Reports the **Median**, **25th percentile ($Q1$)**, and **75th percentile ($Q3$)** discount range.

### 3.3 Price Volatility (CV)
Measures the relative standard deviation of the **Daily Best Trusted Price** on observed calendar days:
* **`Stable`** ($CV < 0.12$, $\le 2$ price changes): Consistent pricing.
* **`Moderate`** ($0.12 \le CV \le 0.30$): Regular discount cycles.
* **`Volatile`** ($CV > 0.30$ or $>6$ shifts): Rapidly fluctuating prices.

### 3.4 Sale Drop Frequency
Calculates the number of discrete sale events over the past 12 months:
* Rated as **`Frequent`** ($\ge 6\text{ sales/yr}$), **`Regular`** ($3\text{--}5\text{ sales/yr}$), or **`Rare`** ($\le 2\text{ sales/yr}$).

---

## 4. BUY / FAIR / WAIT Recommendation Engine

The recommendation card provides factual guidance based on strict deterministic precedence:

```text
1. Pricing Error Guard
   └─ isLikelyPricingError = true ──────────────> WAIT (Score 0, Warning Badge)

2. Overpriced Check
   └─ Price > Steam Base MSRP ──────────────────> OVERPRICED

3. Insufficient Data Check
   └─ Sparse history and at full MSRP ──────────> WAIT (Low confidence)

4. BUY Rules (First match wins)
   ├─ Matches confirmed All-Time Low (ATL)
   ├─ Price is >= 15% below Typical Sale Median
   └─ Deal Score >= 80 ─────────────────────────> INSTANT_BUY (High confidence)

5. GREAT_DEAL Rules
   └─ Deal Score >= 60 ─────────────────────────> GREAT_DEAL

6. FAIR Rules
   ├─ Within Typical Sale Band (Q1 – Q3 / ±10%)
   ├─ Decent sale (Discount >= 30%, Score >= 40)
   └─ Near 90-day low (Discount >= 25%) ─────────> FAIR_DEAL (Medium confidence)

7. WAIT Fallback
   └─ Full MSRP or weak discount ───────────────> WAIT (Medium/High confidence)
```

---

## 5. Review & Rating Enrichment

* **Steam Reviews:** Displays sentiment text (e.g. "Very Positive"), positive percentage, and formatted review totals.
* **SteamDB Rating:** Calculates the Bayesian Wilson score rating.
* **Metacritic Integration:** Displays Metacritic critic score (0–100) and direct review links enriched automatically via CheapShark batching.

---

## 6. Navigation Tabs & High-Capacity View Modes

For wishlists with 2,500+ items, Pricetool provides dedicated navigation and layout modes:

### 6.1 Main Navigation Tabs
* **Wishlist Deals**: Paid wishlist games, filtering out free titles so metrics remain unskewed.
* **Free to Play**: Gathers all free titles (`is_free = 1`) with direct Steam store links and 1-click launch (`steam://run/<appId>`).
* **Top Best Deals**: Highlights the highest Deal Score opportunities across the entire catalog.
* **Data Safety**: Dedicated review interface for active pricing errors with 1-click dismissal and 14-column CSV export.

### 6.2 3 Ergonomic View Modes
* 🔲 **Grid View**: Visual cover artwork with Deal Score badges, price tags, and quick price event flags.
* 📄 **Compact List View**: Single-line dense horizontal cards showing Priority, Title, Steam MSRP, Best Deal, Discount %, Store badge, and deal links.
* 📊 **Dense Table View**: Data-dense tabular layout with sortable headers, compact indicators, and quick action buttons.

### 6.3 Page Size Flexibility
Choose between **24**, **50**, **100**, or **200 items per page**. View mode preferences are automatically remembered via `localStorage`.
