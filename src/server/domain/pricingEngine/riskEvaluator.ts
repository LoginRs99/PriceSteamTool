import type { PriceRiskLevel, PriceRiskFlag } from '../../../shared/types.js';
import type { PriceEvaluationInput } from './types.js';
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

  const msrp = basePriceEur || originalPriceEur || 0;
  let rawSeverity = 0.0;

  const sourceCheck = evaluateSourceOwnHistoryAnomaly(currentPriceEur, sourceHistoryEur);
  const peers = marketPricesEur.filter(p => p > 0);
  const validPeers = peers;
  const hasCorroboratingPeer = peers.some(p => {
    const relDiff = Math.abs(p - currentPriceEur) / Math.min(p, currentPriceEur);
    return relDiff <= 0.40;
  });

  const allLiveOffers = [currentPriceEur, ...peers].sort((a, b) => a - b);
  const minLiveOffer = allLiveOffers.length > 0 ? allLiveOffers[0] : currentPriceEur;
  const isCheapestCandidate = currentPriceEur <= minLiveOffer * 1.02;

  // 1. Peer-Market Anomaly Signals (strictly guarded by cheapest-candidate policy)

  // 1A. Sub-euro / extreme ratio drop glitch check (<€1.00 or <5% of MSRP)
  if (isCheapestCandidate && (currentPriceEur < 1.00 || (msrp > 0 && currentPriceEur < msrp * 0.05))) {
    if (peers.length === 0 || !hasCorroboratingPeer) {
      rawSeverity = Math.max(rawSeverity, 0.85);
      flags.add('SUB_EURO_PREMIUM_GLITCH');
    } else {
      rawSeverity = Math.max(rawSeverity, 0.35);
      flags.add('SUB_EURO_PREMIUM_GLITCH_CORROBORATED');
    }
  }

  // 1B. Lone bottom outlier check (primary driver of HIGH risk for live market bottom outlier)
  if (isCheapestCandidate && allLiveOffers.length >= 2 && allLiveOffers[0] === currentPriceEur) {
    const secondCheapest = allLiveOffers[1];
    if (secondCheapest > 0 && currentPriceEur < secondCheapest * 0.55) {
      rawSeverity = Math.max(rawSeverity, 0.90);
      flags.add('LONE_BOTTOM_OUTLIER');
    }
  }

  // 1C. Market median divergence (capped at 0.35 so it cannot reach HIGH risk on its own)
  if (isCheapestCandidate && validPeers.length >= 2) {
    const sorted = [...validPeers].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    if (median >= 1.00 && currentPriceEur < median * 0.25) {
      rawSeverity = Math.max(rawSeverity, 0.35);
      flags.add('EXTREME_MEDIAN_OUTLIER');
    } else if (median >= 1.00 && currentPriceEur < median * 0.40) {
      rawSeverity = Math.max(rawSeverity, 0.35);
      flags.add('SOURCE_DISAGREEMENT');
    }
  }

  // 1D. Historical Low Discrepancy (historicalLowEur >= €2.00)
  if (isCheapestCandidate && historicalLowEur && historicalLowEur >= 2.00 && currentPriceEur < historicalLowEur * 0.20 && validPeers.length >= 2) {
    rawSeverity = Math.max(rawSeverity, 0.50);
    flags.add('HISTORICAL_LOW_DISCREPANCY');
  }

  // 2. Own-History Signal & Peer Corroboration
  if (sourceCheck.applicable && sourceCheck.isBreak) {
    flags.add('SOURCE_OWN_HISTORY_BREAK');
    if (hasCorroboratingPeer) {
      // Legitimate market-wide sale: peer market corroborates the new price level
      rawSeverity = Math.max(rawSeverity, 0.15);
      flags.add('SOURCE_OWN_HISTORY_BREAK_CORROBORATED');
    } else if (isCheapestCandidate) {
      // Lone break from established history without live peer corroboration on cheapest candidate
      rawSeverity = Math.max(rawSeverity, 0.90);
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
