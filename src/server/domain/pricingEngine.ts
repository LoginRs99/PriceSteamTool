import type { 
  PriceEventType, 
  PriceRiskLevel, 
  PriceRiskFlag, 
  PriceEvaluation 
} from '../../shared/types.js';

export interface PriceEvaluationInput {
  currentPriceEur: number;
  originalPriceEur?: number;
  basePriceEur?: number;           // Steam MSRP
  historicalLowEur?: number;
  previousPriceEur?: number;       // Previous recorded price
  marketPricesEur?: number[];      // Other active store prices for this game
  sourceAgreementCount: number;    // Distinct source adapters observing this canonical offer
  isOfficialMerchant: boolean;     // Official licensed retailer vs marketplace
  merchantTrustScore?: number;     // 0.0 - 1.0
  gameReleaseDate?: string;        // Release date string (ISO)
  productType?: string;            // STEAM_KEY, DIRECT_PURCHASE etc.
  regionConfidence?: number;       // 0.0 - 1.0
  isStaleObservation?: boolean;    // Observation older than 24h/stale
}

/**
 * Evaluates the market event of an offer (discount magnitude, historical record, price direction).
 */
export function detectPriceEvent(input: PriceEvaluationInput, confidence: number, riskLevel: PriceRiskLevel): PriceEventType {
  const { currentPriceEur, originalPriceEur, basePriceEur, historicalLowEur, previousPriceEur, isOfficialMerchant, sourceAgreementCount } = input;
  
  if (currentPriceEur <= 0) {
    return 'NONE';
  }

  // 1. Check for price increase vs previous price
  if (previousPriceEur !== undefined && previousPriceEur > 0 && currentPriceEur > previousPriceEur) {
    return 'PRICE_INCREASE';
  }

  // 2. Check for Historical Low
  if (historicalLowEur !== undefined && historicalLowEur > 0) {
    if (currentPriceEur < historicalLowEur * 0.98) {
      // Confirmed if high confidence or multi-source consensus and not high risk
      if ((sourceAgreementCount >= 2 || (isOfficialMerchant && confidence >= 0.70)) && riskLevel !== 'HIGH') {
        return 'NEW_HISTORICAL_LOW';
      }
      return 'SUSPECTED_HISTORICAL_LOW';
    } else if (currentPriceEur <= historicalLowEur * 1.02 && riskLevel !== 'HIGH') {
      return 'AT_HISTORICAL_LOW';
    } else if (currentPriceEur <= historicalLowEur * 1.10 && riskLevel !== 'HIGH') {
      return 'NEAR_HISTORICAL_LOW';
    }
  }

  // 3. Magnitude Evaluation against MSRP / Original price
  const msrp = basePriceEur || originalPriceEur || 0;
  if (msrp <= 0) {
    return 'NONE';
  }

  const discountPercent = Math.max(0, ((msrp - currentPriceEur) / msrp) * 100);
  const absoluteDropEur = Math.max(0, msrp - currentPriceEur);

  // High-value titles (MSRP >= 30€) or large drops
  if (discountPercent >= 75 && (absoluteDropEur >= 25 || msrp >= 30)) {
    return 'EXTREME_DROP';
  }

  if (discountPercent >= 50 && absoluteDropEur >= 15) {
    return 'MAJOR_DROP';
  }

  if (discountPercent >= 30 || absoluteDropEur >= 10) {
    return 'SIGNIFICANT_DROP';
  }

  if (discountPercent >= 10) {
    return 'STANDARD_SALE';
  }

  return 'NONE';
}

/**
 * Internal only — feeds risk scoring & event classification. NOT the user-facing "Confidence" shown in the UI; see dealScore.ts:calculateDataConfidence for that.
 * Calculates data confidence (0.10 - 1.00) based on source redundancy, market peer depth, and freshness.
 * Stale observations lower confidence, but do NOT artificially inflate price risk.
 */
export function calculateRiskEvidenceConfidence(
  input: PriceEvaluationInput,
  flags: Set<PriceRiskFlag>
): number {
  const { sourceAgreementCount, marketPricesEur = [], basePriceEur, historicalLowEur, isStaleObservation, originalPriceEur, gameReleaseDate } = input;
  
  let score = 0.35; // Baseline for 1 source

  // 1. Source consensus redundancy
  if (sourceAgreementCount >= 3) {
    score += 0.45; // 0.80
  } else if (sourceAgreementCount === 2) {
    score += 0.30; // 0.65
  }

  // 2. Market peer depth (other active stores for this game)
  const peerCount = marketPricesEur.filter(p => p > 0).length;
  if (peerCount >= 4) {
    score += 0.15;
  } else if (peerCount >= 2) {
    score += 0.10;
  }

  // 3. Baseline anchors
  if (basePriceEur && basePriceEur > 0) {
    score += 0.05;
  }
  if (historicalLowEur && historicalLowEur > 0) {
    score += 0.05;
  }

  // 4. Penalties for missing context or stale data
  if (isStaleObservation) {
    score -= 0.20;
    flags.add('STALE_OBSERVATION');
  }

  if (!basePriceEur && !originalPriceEur) {
    score -= 0.15;
    flags.add('MISSING_MSRP_ANCHOR');
  }

  if (!gameReleaseDate) {
    score -= 0.05;
  }

  return Math.max(0.10, Math.min(1.0, Math.round(score * 100) / 100));
}

/**
 * Calculates price risk score (0.00 - 1.00) using a bounded evidence multiplier.
 */
export function calculatePriceRisk(
  input: PriceEvaluationInput,
  flags: Set<PriceRiskFlag>
): { riskScore: number; riskLevel: PriceRiskLevel } {
  const {
    currentPriceEur,
    basePriceEur,
    originalPriceEur,
    historicalLowEur,
    marketPricesEur = [],
    sourceAgreementCount,
    isOfficialMerchant,
    merchantTrustScore = isOfficialMerchant ? 0.95 : 0.60,
    gameReleaseDate
  } = input;

  if (currentPriceEur <= 0) {
    return { riskScore: 0.0, riskLevel: 'SAFE' };
  }

  const msrp = basePriceEur || originalPriceEur || 0;
  let rawSeverity = 0.0;

  // 1. Sub-euro premium glitch check (e.g. €0.49 on €60 title)
  if (msrp >= 29.99 && currentPriceEur < 1.00) {
    rawSeverity = Math.max(rawSeverity, 0.85);
    flags.add('SUB_EURO_PREMIUM_GLITCH');
  }

  // 2. Severe market median divergence
  const validPeers = marketPricesEur.filter(p => p > 0);
  if (validPeers.length >= 2) {
    const sorted = [...validPeers].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    if (median >= 10.0 && currentPriceEur < median * 0.25) {
      rawSeverity = Math.max(rawSeverity, 0.70);
      flags.add('EXTREME_MEDIAN_OUTLIER');
    } else if (median >= 10.0 && currentPriceEur < median * 0.40) {
      rawSeverity = Math.max(rawSeverity, 0.40);
      flags.add('SOURCE_DISAGREEMENT');
    }
  }

  // 3. Historical Low Discrepancy
  if (historicalLowEur && historicalLowEur >= 20.0 && currentPriceEur < historicalLowEur * 0.20 && validPeers.length >= 2) {
    rawSeverity = Math.max(rawSeverity, 0.50);
    flags.add('HISTORICAL_LOW_DISCREPANCY');
  }

  // 4. Fresh release anomaly check
  let isFreshRelease = false;
  if (gameReleaseDate) {
    const releaseTime = new Date(gameReleaseDate).getTime();
    if (!isNaN(releaseTime)) {
      const ageDays = (Date.now() - releaseTime) / (1000 * 3600 * 24);
      if (ageDays >= 0 && ageDays < 90 && msrp >= 40 && currentPriceEur < msrp * 0.30) {
        isFreshRelease = true;
        rawSeverity = Math.max(rawSeverity, 0.45);
        flags.add('FRESH_RELEASE_UNEXPECTED_DROP');
      }
    }
  }

  // 5. Source unconfirmed flags
  if (sourceAgreementCount <= 1) {
    if (!isOfficialMerchant) {
      flags.add('UNCONFIRMED_KEYSHOP');
    }
    if (rawSeverity > 0.3) {
      flags.add('SINGLE_UNVERIFIED_SOURCE');
    }
  }

  // ----------------------------------------------------
  // Apply Multi-Signal Corroboration & Trust Multipliers
  // ----------------------------------------------------

  // A. Source agreement dampening
  let sourceMultiplier = 1.0;
  if (sourceAgreementCount >= 3) {
    sourceMultiplier = 0.20; // 3+ independent sources heavily dampens glitch risk
  } else if (sourceAgreementCount === 2) {
    sourceMultiplier = 0.45;
  }

  // B. Merchant trust dampening
  let merchantMultiplier = 1.0;
  if (isOfficialMerchant) {
    merchantMultiplier = 0.70;
  } else {
    merchantMultiplier = Math.max(0.75, 1.15 - merchantTrustScore * 0.35);
  }

  // Calculate composite risk score
  let compositeRisk = rawSeverity * sourceMultiplier * merchantMultiplier;

  // Unconfirmed keyshop baseline small buffer if no other peer exists
  if (!isOfficialMerchant && sourceAgreementCount <= 1 && rawSeverity > 0) {
    compositeRisk += 0.10;
  }

  const finalScore = Math.max(0.0, Math.min(1.0, Math.round(compositeRisk * 100) / 100));

  let riskLevel: PriceRiskLevel = 'SAFE';
  if (finalScore >= 0.70) {
    riskLevel = 'HIGH';
  } else if (finalScore >= 0.45) {
    riskLevel = 'MEDIUM';
  } else if (finalScore >= 0.20) {
    riskLevel = 'LOW';
  } else {
    riskLevel = 'SAFE';
  }

  return { riskScore: finalScore, riskLevel };
}

/**
 * Primary 2D Pricing Engine Evaluator.
 * Orchestrates Event Detection, Risk Scoring, and Confidence Evaluation.
 */
export function evaluatePriceMovement(input: PriceEvaluationInput): PriceEvaluation {
  const flags = new Set<PriceRiskFlag>();

  // 1. Calculate Confidence (data richness and freshness)
  const confidence = calculateRiskEvidenceConfidence(input, flags);

  // 2. Calculate Risk
  const { riskScore, riskLevel } = calculatePriceRisk(input, flags);

  // 3. Detect Market Event
  const event = detectPriceEvent(input, confidence, riskLevel);

  // 4. Generate Summary Text
  let summary = 'Standard Pricing';
  if (event === 'NEW_HISTORICAL_LOW') {
    summary = '🏆 Confirmed All-Time Low';
  } else if (event === 'SUSPECTED_HISTORICAL_LOW') {
    summary = '⚡ Unconfirmed Record Drop';
  } else if (event === 'EXTREME_DROP') {
    summary = '🔥 Extreme Price Drop';
  } else if (event === 'MAJOR_DROP') {
    summary = '🔥 Major Price Drop';
  } else if (event === 'SIGNIFICANT_DROP') {
    summary = '✨ Significant Discount';
  } else if (event === 'STANDARD_SALE') {
    summary = '🏷️ On Sale';
  } else if (event === 'PRICE_INCREASE') {
    summary = '📈 Price Increased';
  }

  if (riskLevel === 'HIGH') {
    summary += ' • ⚠️ High Risk Anomaly';
  } else if (riskLevel === 'MEDIUM') {
    summary += ' • Caution Advised';
  }

  return {
    event,
    riskLevel,
    riskScore,
    riskFlags: Array.from(flags),
    confidence,
    summary,
    isAnomaly: riskLevel === 'HIGH'
  };
}
