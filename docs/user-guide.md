# Pricetool User & Intelligence Guide

This guide explains how **Pricetool** evaluates game discounts, calculates deal quality, and generates actionable purchase advice.

---

## 1. 2D Pricing Engine Concepts

Pricetool separates **price magnitude** from **data reliability / risk**. A huge discount from an unverified store is analyzed differently from an official publisher sale.

### 1.1 Price Event
Identifies the market significance of a price change relative to Steam MSRP and historical records:
* **`NEW_HISTORICAL_LOW`**: The price has dropped $\ge 2\%$ below the previously confirmed All-Time Low, corroborated by multiple sources or high-confidence official channels.
* **`AT_HISTORICAL_LOW`**: The price matches the confirmed All-Time Low ($\pm 2\%$).
* **`NEAR_HISTORICAL_LOW`**: The price is within $10\%$ of the All-Time Low.
* **`EXTREME_DROP`**: $\ge 75\%$ discount or $\ge 25\text{ €}$ absolute drop on higher-value games ($MSRP \ge 30\text{ €}$).
* **`MAJOR_DROP`**: $\ge 50\%$ discount with $\ge 15\text{ €}$ absolute savings.
* **`SIGNIFICANT_DROP`**: $\ge 30\%$ discount or $\ge 10\text{ €}$ absolute savings.
* **`STANDARD_SALE`**: $\ge 10\%$ discount.
* **`MINOR_DROP`**: $< 10\%$ discount.
* **`PRICE_INCREASE`**: Price is higher than the previous observation.
* **`NONE`**: Standard full price (MSRP).

### 1.2 Risk Level & Risk Score
Evaluates the probability that a recorded price is a pricing glitch, scam, or region-locked mismatch:
* **`SAFE`** ($Score < 0.20$): Verified official store or corroborated multi-source consensus.
* **`LOW`** ($0.20 \le Score < 0.45$): Minor single-source listing with trustworthy merchant metadata.
* **`MEDIUM`** ($0.45 \le Score < 0.70$): Significant divergence from peer stores or unverified keyshop.
* **`HIGH`** ($Score \ge 0.70$): Sub-euro glitch on a premium title (e.g. 0.49 € on a 60 € game), severe market outlier, or region mismatch.

### 1.3 Data Confidence (0.10 – 1.00)
Measures the depth and freshness of corroborating evidence:
* **1 Source**: Baseline $\approx 0.35$ – $0.55$.
* **2 Sources**: $\approx 0.65$ – $0.80$.
* **3+ Sources**: $\ge 0.85$.
* **Stale Observation Penalty**: Observations older than 24h lose $0.20$ confidence.

---

## 2. Computed Deal Score (0 – 100)

The **Deal Score** summarizes deal attractiveness across 4 pillars:

$$\text{RawScore} = \Big(\text{DiscountScore} (0\text{--}45) + \text{HistoricalScore} (0\text{--}35) + \text{TrustScore} (0\text{--}20)\Big) \times \text{ConfidenceMultiplier} - \text{RiskPenalty}$$

### 2.1 Pillars
1. **Discount Pillar (0–45 pts):** Linear scaling up to 45 pts at 90%+ discount.
2. **Historical Pillar (0–35 pts):**
   * `NEW_HISTORICAL_LOW`: +35 pts
   * `AT_HISTORICAL_LOW`: +28 pts
   * `NEAR_HISTORICAL_LOW`: +20 pts
   * `EXTREME_DROP` / `MAJOR_DROP`: +15 pts
   * `SIGNIFICANT_DROP`: +10 pts
   * `STANDARD_SALE`: 0 pts
3. **Trust Pillar (0–20 pts):**
   * Official Retailer: +10 pts (Keyshop: +6 pts if verified, +2 pts otherwise)
   * Source Consensus: +4 pts (1 source), +7 pts (2 sources), +10 pts (3+ sources)
4. **Risk Penalties & Safety Guard:**
   * Risk Penalty: `SAFE` = 0, `LOW` = 5, `MEDIUM` = 25, `HIGH` = 60.
   * **HIGH Risk Safety Cap:** If risk level is `HIGH`, the final Deal Score is strictly capped at **35**.

### 2.2 Score Tiers
* **`Exceptional`** (85 – 100): Rare buying opportunity (ATL + deep discount + official store).
* **`Great`** (70 – 84): Strong discount from trusted retailers.
* **`Fair`** (50 – 69): Decent regular sale price.
* **`Weak`** (0 – 49): Minor discount, full price, or high-risk outlier.

---

## 3. Price Intelligence & Historical Context

### 3.1 Rolling Period Lows
Tracks the lowest observed trusted price across defined time windows:
* **7-Day Low**, **30-Day Low**, **90-Day Low**, **1-Year Low**, and **Confirmed All-Time Low (ATL)**.
* **No Synthetic Assumptions:** If a game has only been tracked for 4 days, 30d/90d/1y lows are explicitly reported as `null` with `isExactPeriodData: false`.

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
* Normal price returns ($price > 0.90 \times MSRP$) terminate an active event.
* Missing sync cycles ($\le 14\text{ days}$) are bridged only if no regular price was observed.
* Rated as **`Frequent`** ($\ge 6\text{ sales/yr}$), **`Regular`** ($3\text{--}5\text{ sales/yr}$), or **`Rare`** ($\le 2\text{ sales/yr}$).

---

## 4. BUY / FAIR / WAIT Recommendation Engine

The recommendation card provides factual guidance based on strict deterministic precedence:

```text
1. Insufficient Data Check
   └─ Sparse history and at full MSRP ──────────> WAIT (Low confidence)

2. High-Risk / Anomaly Guard
   └─ Risk level HIGH or isAnomaly = true ──────> WAIT (High confidence)

3. BUY Rules (First match wins)
   ├─ Matches confirmed All-Time Low (ATL)
   ├─ Price is >= 15% below Typical Sale Median
   └─ Deal Score >= 80 ─────────────────────────> BUY (High confidence)

4. FAIR Rules
   ├─ Within Typical Sale Band (Q1 – Q3 / ±10%)
   ├─ Decent sale (Discount >= 30%, Score >= 50)
   └─ Near 90-day low (Discount >= 25%) ─────────> FAIR (Medium confidence)

5. WAIT Fallback
   └─ Full MSRP or weak discount ───────────────> WAIT (Medium/High confidence)
```

---

## 5. Navigation Tabs & High-Capacity View Modes

For wishlists with 2,500+ items, Pricetool provides dedicated navigation and layout modes:

### 5.1 Main Navigation Tabs
* **Wishlist Deals**: Focuses exclusively on paid games on your wishlist, filtering out free titles so average discount percentages and deal metrics remain unskewed.
* **Free to Play**: Gathers all free titles (`is_free = 1` or free-to-play) in one place with direct **Steam Store** links and **1-Click Launch/Install** (`steam://run/<appId>`) buttons.
* **Top Best Deals**: Highlights the highest Deal Score opportunities across the entire catalog.

### 5.2 3 Ergonomic View Modes
* 🔲 **Grid View**: Visual cover artwork with Deal Score badges, price tags, and quick price event flags (ideal for visual browsing).
* 📄 **Compact List View**: Single-line dense horizontal cards showing Priority, Title, Steam MSRP, Best Deal, Discount %, Store badge, and direct deal links.
* 📊 **Dense Table View**: Data-dense tabular layout with sortable headers, compact indicators, and quick action buttons.

### 5.3 Page Size Flexibility
Choose between **24**, **50**, **100**, or **200 items per page** from the dropdown selector. View mode preferences are automatically remembered across browser sessions via `localStorage`.

