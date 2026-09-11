import type { PriceEvaluationInput, PriceRiskLevel, PriceRiskFlag } from './types.js';
import { evaluateSourceOwnHistoryAnomaly } from './historyAnomaly.js';

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
 * Calculates price risk score (0.00 - 1.00) for Anomaly V2 pricing error detection.
 * Evaluates peer market divergence, second-lowest price divergence, merchant own-history breaks,
 * and sub-euro glitch corroboration without penalizing merchant type or static MSRP discount percentage.
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
    sourceHistoryEur = [],
    sourceAgreementCount,
    isOfficialMerchant,
    merchantTrustScore = isOfficialMerchant ? 0.95 : 0.60,
    gameReleaseDate
  } = input;

  if (currentPriceEur <= 0) {
    return { riskScore: 0.0, riskLevel: 'SAFE' };
  }

  // 1. Price increases or unchanged prices are NEVER anomalies or pricing glitches
  const prevPrice = input.previousPriceEur;
  if (prevPrice !== undefined && prevPrice > 0 && currentPriceEur >= prevPrice - 0.005) {
    return { riskScore: 0.0, riskLevel: 'SAFE' };
  }

  const msrp = basePriceEur || originalPriceEur || 0;
  let rawSeverity = 0.0;

  const sourceCheck = evaluateSourceOwnHistoryAnomaly(currentPriceEur, sourceHistoryEur);
  const peers = marketPricesEur.filter(p => p > 0);
  const minPeerPrice = peers.length > 0 ? Math.min(...peers) : Infinity;

  // 2. Fundamental Safety Rule: If another active store is cheaper than (or equal to) this offer,
  // this offer CANNOT be a low-price bottom outlier or glitch!
  if (minPeerPrice < currentPriceEur - 0.01) {
    if (sourceCheck.applicable && sourceCheck.isBreak) {
      flags.add('SOURCE_OWN_HISTORY_BREAK');
      flags.add('SOURCE_OWN_HISTORY_BREAK_CORROBORATED');
    }
    return { riskScore: 0.0, riskLevel: 'SAFE' };
  }

  const validPeers = peers;
  const hasCorroboratingPeer = peers.some(p => {
    const relDiff = Math.abs(p - currentPriceEur) / Math.min(p, currentPriceEur);
    return relDiff <= 0.40;
  });

  const allLiveOffers = [currentPriceEur, ...peers].sort((a, b) => a - b);
  const isCheapestCandidate = true; // Guaranteed by the minPeerPrice check above

  // 3. Peer-Market Anomaly Signals (only evaluated when this offer is the cheapest on the market)

  // 3A. Sub-euro / extreme ratio drop glitch check
  // True sub-euro glitches (<€1.00) occur on premium games (MSRP >= €15.00, e.g. €20 - €70 game accidentally listed under €1)
  // OR on ANY game when the discount is extreme / implausible (>95% discount, price < 5% of MSRP, e.g. €0.10 on a €9 game).
  // Standard 85-90% discounts on older/budget catalog games (MSRP < €15.00, e.g. €8.99 -> €0.89) are legitimate sales.
  const isSubEuroGlitch = (currentPriceEur < 1.00 && msrp >= 15.0) || (msrp > 0 && currentPriceEur < msrp * 0.05);
  if (isSubEuroGlitch) {
    if (peers.length === 0 || !hasCorroboratingPeer) {
      rawSeverity = Math.max(rawSeverity, 0.85);
      flags.add('SUB_EURO_PREMIUM_GLITCH');
    } else {
      rawSeverity = Math.max(rawSeverity, 0.35);
      flags.add('SUB_EURO_PREMIUM_GLITCH_CORROBORATED');
    }
  }

  // 3B. Lone bottom outlier check (>50% below the next cheapest store on the market)
  if (peers.length >= 1 && minPeerPrice < Infinity) {
    if (currentPriceEur < minPeerPrice * 0.50) {
      rawSeverity = Math.max(rawSeverity, 0.90);
      flags.add('LONE_BOTTOM_OUTLIER');
    }
  }

  // 3C. Market median divergence (capped at 0.35 so it cannot reach HIGH risk on its own)
  if (validPeers.length >= 2) {
    const sorted = [...validPeers].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    if (median >= 2.00 && currentPriceEur < median * 0.25) {
      rawSeverity = Math.max(rawSeverity, 0.35);
      flags.add('EXTREME_MEDIAN_OUTLIER');
    } else if (median >= 2.00 && currentPriceEur < median * 0.40) {
      rawSeverity = Math.max(rawSeverity, 0.35);
      flags.add('SOURCE_DISAGREEMENT');
    }
  }

  // 3D. Historical Low Discrepancy (historicalLowEur >= €2.00, dropping >80% below ATL)
  if (historicalLowEur && historicalLowEur >= 2.00 && currentPriceEur < historicalLowEur * 0.20 && validPeers.length >= 2) {
    rawSeverity = Math.max(rawSeverity, 0.50);
    flags.add('HISTORICAL_LOW_DISCREPANCY');
  }

  // 4. Own-History Signal & Peer Corroboration
  if (sourceCheck.applicable && sourceCheck.isBreak) {
    flags.add('SOURCE_OWN_HISTORY_BREAK');
    if (hasCorroboratingPeer) {
      // Legitimate market-wide sale: peer market corroborates the new price level
      rawSeverity = Math.max(rawSeverity, 0.15);
      flags.add('SOURCE_OWN_HISTORY_BREAK_CORROBORATED');
    } else {
      // Only treat as high risk if the drop is an extreme crash (<15% of MSRP or <20% of own median)
      const ownMedian = sourceCheck.ownMedian || currentPriceEur;
      const isOfficialLegitSale = isOfficialMerchant && (msrp > 0 ? currentPriceEur >= msrp * 0.08 : true);
      const isExtremeCrash = !isOfficialLegitSale && (
        (msrp >= 20 && currentPriceEur < msrp * 0.15) || 
        (ownMedian >= 20 && currentPriceEur < ownMedian * 0.20) ||
        (currentPriceEur < 1.00 && msrp >= 20) ||
        (msrp > 0 && currentPriceEur < msrp * 0.05)
      );
      if (isExtremeCrash) {
        rawSeverity = Math.max(rawSeverity, 0.85);
      } else {
        // Normal 50-90% seasonal sale: not an anomaly
        rawSeverity = Math.max(rawSeverity, 0.20);
      }
    }
  }

  // 4. Fresh release anomaly check
  let isFreshRelease = false;
  if (gameReleaseDate && isCheapestCandidate) {
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

  // A. Independent merchant vs source aggregator agreement dampening
  const merchantCount = input.independentMerchantCount ?? (hasCorroboratingPeer ? 2 : 1);
  let corroborationMultiplier = 1.0;
  if (merchantCount >= 3) {
    corroborationMultiplier = 0.20; // 3+ distinct merchants confirms market price level
  } else if (merchantCount === 2) {
    corroborationMultiplier = 0.45; // 2 distinct merchants
  } else if (sourceAgreementCount >= 2 && isOfficialMerchant) {
    corroborationMultiplier = 0.80; // multiple scrapers observing an official store
  }

  // B. Merchant trust dampening
  const effectiveTrust = merchantTrustScore ?? (isOfficialMerchant ? 0.95 : 0.85);
  const merchantMultiplier = Math.max(0.70, 1.15 - effectiveTrust * 0.45);

  // Calculate composite risk score
  const compositeRisk = rawSeverity * corroborationMultiplier * merchantMultiplier;

  const finalScore = Math.max(0.0, Math.min(1.0, Math.round(compositeRisk * 100) / 100));

  let riskLevel: PriceRiskLevel = 'SAFE';
  if (finalScore >= 0.60) {
    riskLevel = 'HIGH';
  } else if (finalScore >= 0.35) {
    riskLevel = 'MEDIUM';
  } else if (finalScore >= 0.15) {
    riskLevel = 'LOW';
  } else {
    riskLevel = 'SAFE';
  }

  return { riskScore: finalScore, riskLevel };
}
