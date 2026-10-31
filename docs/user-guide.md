# Pricetool User & Intelligence Guide

This guide explains how **Pricetool** evaluates game discounts, calculates deal quality, detects pricing errors, generates actionable purchase advice, tracks realized savings, and handles multi-currency conversion (v2.7.0).

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
* **`SOURCE_FAMILY_CONFLICT`**: Severe intra-family price split between official stores and keyshops under the same aggregator (e.g. GG.deals). Offers at or above a known confirmed low (`price >= ATL - 0.05`) are immune. For prices $> 1.005\text{ €}$, only extreme uncorroborated discrepancies ($\ge 12.0\times$) are flagged, while sub-euro glitches ($\le 1.005\text{ €}$) require a $\ge 3.0\times$ split.
* **`OVER_MSRP`**: Informational indicator signaling when an offer exceeds official Steam baseline MSRP.
* **`MARKET_OUTLIER`**: Lone store $> 50\%$ below single peer or $> 75\%$ below multi-peer median (threshold 0.55 on cheapest comparable offer with $\ge 2.00\text{ €}$ gap).
* **`BELOW_ATL_IMPLAUSIBLE`**: Price $> 50\%$ below established confirmed ATL.
* **`OWN_HISTORY_BREAK`**: Sudden price collapse vs merchant's own historical median ($z > 2.5$).
* **`FRESH_RELEASE_DROP`**: $> 40\%$ drop on games released $< 30$ days ago without publisher confirmation.
* **`EDITION_INVERSION`**: Deluxe/Gold edition cheaper than base game by $> 30\%$.
* **`FAKE_DISCOUNT`**: Claimed original price $> 1.5\times$ base MSRP.
* **Independent Corroboration**: When $\ge 2$ independent fresh peer prices match within $\pm 40\%$, selling-price anomaly flags are overridden.
* **Automated Self-Healing**: Dismisses errors automatically when prices rise, when cheaper valid deals exist, or when offers match known historical lows. Flagged offers are excluded from best deal calculations.
* **User Feedback Loop**: Users can verify anomalies directly in the Data Safety tab by clicking **"Valódi hiba"** (Confirmed Error) or **"Téves riasztás"** (False Positive). Flagging an offer as a false positive immediately clears the flag and restores it to Best Deals.

---

## 2. Computed Deal Score v2.4 (0 – 100)

The **Deal Score v2.4** provides an objective, monotonic mathematical evaluation of deal attractiveness across 4 pillars:

$$\text{RawScore} = S_{\text{atl}} (0\text{--}40) + S_{\text{disc}} (0\text{--}30) + S_{\text{hist}} (0\text{--}20) + S_{\text{mkt}} (0\text{--}10)$$

### 2.1 The 4 Pillars

1. **$S_{\text{atl}}$ (Proximity to All-Time Low, 0–40 pts):**
   * At confirmed ATL ($price = atl$), awards **36 points base**.
   * Undercutting confirmed ATL awards up to **+4 points bonus** (maxing at 20% undercut).
   * Unconfirmed or single-source keyshop ATL is penalized by 50% ($S_{\text{atl}} \times 0.5$).
   * Scales proportionally with discount depth relative to MSRP anchor (never-discounted games with ATL $\approx$ MSRP receive low/zero $S_{\text{atl}}$ score).
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

### 2.2 Safety Caps & Continuous Confidence Ramps

* **Provisional History Cap:** If $< 5$ historical samples are recorded:
  * Discount $\ge 60\%$: Capped at **80** (or **85** for official store with known MSRP).
  * Has some history: Capped at **65**.
  * No history at all: Capped at **40**.
* **Stale History Cap:** If observations are $> 90$ days old, score is capped at **60**.
* **Score 100 Reservation:** Score is capped at **99** unless the price beats the confirmed ATL by $\ge 5\%$.
* **Pricing Error Cap:** Any active pricing error yields **Score 0**, **Tier Weak**, **Verdict WAIT**.
* **Continuous Sigmoid Ramps**: Sample counts and recency ramp smoothly using logistic sigmoid curves rather than stepped thresholds.
* **Weighted Geometric Mean**: Multiple confidence factors are aggregated with floor protection to prevent a single weak factor from zeroing overall confidence.

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

## 5. 💰 Realized Savings & Purchase Journal ("Megtakarítások")

Pricetool includes a built-in purchase journal to track bought games and calculate your cumulative financial savings:

### 5.1 Logging a Purchase ("Megvettem")
* From the **Offers Table** inside any game slide-in panel, click the green **"Megvettem"** button next to the deal you purchased.
* The system snapshots:
  * **Purchase Price**: Exact price paid.
  * **MSRP Snapshot**: Official Steam baseline MSRP at that moment.
  * **Typical Median Snapshot**: Tukey IQR historical sale median at that moment.
  * **Savings vs MSRP**: Money saved compared to buying at full price.
  * **Savings vs Median**: Money saved compared to standard repeating sales.

### 5.2 Savings Analytics Dashboard
Accessible via the **Megtakarítások** tab on the navigation bar:
* **Total Spent**: Total money spent across all purchases.
* **Savings vs MSRP**: Cumulative money saved vs full retail price.
* **Savings vs Typical Sale**: True net savings beating regular recurring discounts.
* **Monthly Spending & Savings Trends**: Bar chart visualizing monthly purchases.
* **Purchase History Table**: List of all bought games with timestamps, stores, and 1-click delete/refund removal.

---

## 6. 💱 Live Multi-Currency Display (EUR, USD, GBP, CAD, AUD, HUF)

* Switch your active currency anytime via the currency selector dropdown in the navigation header.
* **Supported Currencies**: `EUR (€)`, `USD ($)`, `GBP (£)`, `CAD ($)`, `AUD ($)`, and `HUF (Ft)`.
* **Hungarian Forint (`HUF`)**: Native localized formatting with integer separation and symbol (e.g. `3 990 Ft`).
* **100% Normalized Database Integrity**: All prices in SQLite remain stored strictly in `EUR`. The client converts values on-the-fly for display and automatically converts target price inputs back to EUR before saving.

---

## 7. 🎯 Smart Target Price Presets

When editing target prices in the slide-in details panel (`TargetPriceEditor.tsx`), quick-select presets recommend optimal alert points:
* 🟢 **Typical**: Sets your target price to the Tukey IQR typical sale median price.
* 🔵 **Great (Q1)**: Sets your target price to the 25th percentile discount price.
* 🟣 **Record Low**: Sets your target price to the confirmed historical all-time low.
Values automatically convert to your selected display currency.

---

## 8. Navigation, Split-View Panel & View Modes

### 8.1 Main Navigation Tabs
* **Wishlist Deals**: Paid wishlist games, filtering out free titles so metrics remain unskewed.
* **Free to Play**: Gathers all free titles (`is_free = 1`) with direct Steam store links and 1-click launch (`steam://run/<appId>`).
* **Top Best Deals**: Highlights the highest Deal Score opportunities across the entire catalog.
* **Data Safety**: Dedicated review interface for active pricing errors with user feedback and 14-column CSV export.
* **Megtakarítások**: Purchase journal and realized savings analytics dashboard.

### 8.2 Hybrid Split-View / Slide-in Details Panel
Clicking any game row opens a slide-in intelligence panel from the right while keeping the main wishlist visible and keyboard-interactive:
* **Keyboard Navigation**: Press `j` / `↓` for next game, `k` / `↑` for previous game, `Enter` to open/jump, and `Escape` to close the panel.
* **Mobile-Responsive**: Automatically transforms into a swipeable bottom sheet on mobile screens (<768px).
* **Target Price Alerts**: Set personal threshold alerts directly inside the game panel with smart preset buttons.
* **Candidate Match Selector**: Fast AllKeyShop match verification with instant non-blocking save and asynchronous background scraping.

### 8.3 Ergonomic View Modes
* 📄 **Compact List View**: Single-line dense horizontal cards showing Priority, Title, Steam MSRP, Best Deal, Discount %, Store badge, and deal links.
* 🔲 **Grid View**: Visual cover artwork with Deal Score badges, price tags, and quick price event flags.

### 8.4 Page Size Flexibility
Choose between **24**, **50**, **100**, or **200 items per page**. View mode preferences are automatically remembered via `localStorage`.
