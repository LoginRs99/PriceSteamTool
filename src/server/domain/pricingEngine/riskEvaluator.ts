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

  if (sourceCheck.applicable) {
    if (sourceCheck.isBreak) {
      rawSeverity = Math.max(rawSeverity, 0.80);
      flags.add('SOURCE_OWN_HISTORY_BREAK');
    }
    // When applicable and NOT a break, this source's price is consistent with its own
    // established pattern — suppress the peer-based flags below for this evaluation,
    // since a stable, self-consistent source shouldn't be penalized for differing
    // from a different market segment's peers (e.g. keyshop vs. official store).
  } else {
    // Fallback: Peer-based anomaly detection when insufficient own history (< 3 observations)

    // 1. Sub-euro / extreme ratio drop glitch check (<€1.00 or <5% of MSRP)
    if (currentPriceEur < 1.00 || (msrp > 0 && currentPriceEur < msrp * 0.05)) {
      const peers = marketPricesEur.filter(p => p > 0);
      const hasCorroboratingPeer = peers.some(p => (Math.abs(p - currentPriceEur) / currentPriceEur) <= 0.30001);

      if (peers.length === 0 || !hasCorroboratingPeer) {
        // No other source to compare against, or genuinely a lone outlier — treat as before.
        rawSeverity = Math.max(rawSeverity, 0.85);
        flags.add('SUB_EURO_PREMIUM_GLITCH');
      } else {
        // At least one other live offer agrees within 30% — likely a real, if steep, price. Downgrade.
        rawSeverity = Math.max(rawSeverity, 0.35);
        flags.add('SUB_EURO_PREMIUM_GLITCH_CORROBORATED');
      }
    }

    // 2. Lone bottom outlier check (primary driver of HIGH risk for live market bottom outlier)
    const allLiveOffers = [currentPriceEur, ...marketPricesEur.filter(p => p > 0)].sort((a, b) => a - b);
    if (allLiveOffers.length >= 2 && allLiveOffers[0] === currentPriceEur) {
      const secondCheapest = allLiveOffers[1];
      if (secondCheapest > 0 && currentPriceEur < secondCheapest * 0.55) {
        rawSeverity = Math.max(rawSeverity, 0.85);
        flags.add('LONE_BOTTOM_OUTLIER');
      }
    }

    // 3. Market median divergence (capped at 0.35 so it cannot reach HIGH risk on its own)
    const validPeers = marketPricesEur.filter(p => p > 0);
    if (validPeers.length >= 2) {
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

    // 4. Historical Low Discrepancy (historicalLowEur >= €2.00)
    if (historicalLowEur && historicalLowEur >= 2.00 && currentPriceEur < historicalLowEur * 0.20 && validPeers.length >= 2) {
      rawSeverity = Math.max(rawSeverity, 0.50);
      flags.add('HISTORICAL_LOW_DISCREPANCY');
    }
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

  // B. Merchant trust dampening (applied uniformly based on trust score)
  const effectiveTrust = merchantTrustScore ?? (isOfficialMerchant ? 0.95 : 0.85);
  const merchantMultiplier = Math.max(0.70, 1.15 - effectiveTrust * 0.45);

  // Calculate composite risk score
  const compositeRisk = rawSeverity * sourceMultiplier * merchantMultiplier;

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
