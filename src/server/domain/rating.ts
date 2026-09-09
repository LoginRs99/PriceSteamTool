/**
 * Rating calculations and normalization utilities.
 */

/**
 * Parses total review counts from strings (e.g. "12,345", "1 200", "500") or numbers.
 */
export function parseReviewTotal(total: string | number | undefined | null): number | undefined {
  if (total === undefined || total === null) return undefined;
  if (typeof total === 'number') {
    return isFinite(total) && total >= 0 ? Math.floor(total) : undefined;
  }
  const clean = String(total).replace(/[^0-9]/g, '');
  if (!clean) return undefined;
  const num = parseInt(clean, 10);
  return isFinite(num) && num >= 0 ? num : undefined;
}

/**
 * Calculates a Bayesian-weighted rating (0.0% - 100.0%) based on SteamDB's algorithm:
 * Rating = RawScore - (RawScore - 0.5) * 2^(-log10(TotalReviews + 1))
 * 
 * Protects against small sample sizes (e.g. 1 positive review != 100% rating)
 * and review-bombing by balancing uncertainty against sample volume.
 *
 * @param positivePercent Positive review percentage (0 - 100)
 * @param totalReviews Total review volume (string or number)
 * @returns Weighted score with 1 decimal precision (e.g. 94.2) or undefined if insufficient data
 */
export function calculateSteamDbRating(
  positivePercent: number | undefined | null,
  totalReviews: string | number | undefined | null
): number | undefined {
  if (positivePercent === undefined || positivePercent === null || isNaN(positivePercent)) {
    return undefined;
  }
  if (positivePercent < 0 || positivePercent > 100) {
    return undefined;
  }

  const count = parseReviewTotal(totalReviews);
  if (count === undefined || count <= 0) {
    return undefined;
  }

  const rawScore = positivePercent / 100;
  // SteamDB certainty factor: 2^(-log10(total + 1))
  const certaintyFactor = Math.pow(2, -Math.log10(count + 1));
  const rating = rawScore - (rawScore - 0.5) * certaintyFactor;

  return Math.round(rating * 1000) / 10;
}
