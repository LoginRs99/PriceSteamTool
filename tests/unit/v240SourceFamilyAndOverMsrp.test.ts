import { describe, it, expect } from 'vitest';
import {
  detectSourceFamilyConflict,
  checkOverMsrp,
  detectPricingError,
  SOURCE_FAMILY_CONFLICT_RATIO,
  OVER_MSRP_TOLERANCE
} from '../../src/server/domain/pricingError/detector.js';
import { evaluatePriceMovement } from '../../src/server/domain/pricingError.js';

/**
 * v2.4.0 ADR-1 + ADR-2 regression suite.
 *
 * Fixtures below are REAL values pulled from a live PriceSteamTool export
 * (2026-09-14, 15-game stratified sample across Indie/AA/AAA, 15EUR-80EUR
 * MSRP). These are not synthetic edge cases — they are what the detector
 * will actually see in production. Do not "fix" a failing test by loosening
 * a threshold without re-reading the roadmap's rationale for that number.
 */
describe('ADR-1: detectSourceFamilyConflict (same-source internal consistency)', () => {
  it('flags real conflicts found in production data', () => {
    // Gatekeeper: GG.deals Keyshops=0.46 vs Official=8.01 -> 17.41x
    const r1 = detectSourceFamilyConflict([
      { subCategory: 'keyshops', priceEur: 0.46 },
      { subCategory: 'official', priceEur: 8.01 }
    ]);
    expect(r1).not.toBeNull();
    expect(r1!.ratio).toBeCloseTo(17.41, 1);

    // Persona 3 Reload: 12.91 vs 46.60 -> 3.61x
    const r2 = detectSourceFamilyConflict([
      { subCategory: 'keyshops', priceEur: 12.91 },
      { subCategory: 'official', priceEur: 46.60 }
    ]);
    expect(r2).not.toBeNull();
    expect(r2!.ratio).toBeCloseTo(3.61, 1);

    // DOOM: The Dark Ages: 18.25 vs 54.37 -> 2.98x
    const r3 = detectSourceFamilyConflict([
      { subCategory: 'keyshops', priceEur: 18.25 },
      { subCategory: 'official', priceEur: 54.37 }
    ]);
    expect(r3).not.toBeNull();
    expect(r3!.ratio).toBeCloseTo(2.98, 1);

    // Persona 4 Golden: 7.73 vs 15.53 -> 2.01x (boundary, just above 2.0)
    const r4 = detectSourceFamilyConflict([
      { subCategory: 'keyshops', priceEur: 7.73 },
      { subCategory: 'official', priceEur: 15.53 }
    ]);
    expect(r4).not.toBeNull();
    expect(r4!.ratio).toBeCloseTo(2.01, 1);
  });

  it('does NOT flag the normal official-vs-keyshop gap (11 other real games, 1.08x-1.90x band)', () => {
    const normalPairs: [number, number][] = [
      [6.25, 8.53],   // Jotunnslayer: Hordes of Hel -> 1.36x
      [8.60, 10.78],  // Outer Wilds -> 1.25x
      [18.02, 24.59], // Valheim -> 1.36x
      [5.32, 6.29],   // Gloomhaven -> 1.18x
      [25.89, 31.06], // HELLDIVERS 2 -> 1.20x
      [18.38, 34.99], // Clair Obscur: Expedition 33 -> 1.90x (boundary, just below 2.0)
      [11.66, 14.88], // A Plague Tale: Requiem -> 1.28x
      [30.49, 35.99], // Ghost of Tsushima Director's Cut -> 1.18x
      [18.29, 22.15], // SILENT HILL 2 -> 1.21x
      [23.84, 30.44], // Borderlands 4 -> 1.28x
      [29.65, 31.99]  // Call of Duty: Black Ops 6 -> 1.08x
    ];
    for (const [keyshops, official] of normalPairs) {
      const result = detectSourceFamilyConflict([
        { subCategory: 'keyshops', priceEur: keyshops },
        { subCategory: 'official', priceEur: official }
      ]);
      expect(result, `${keyshops} vs ${official} should NOT conflict`).toBeNull();
    }
  });

  it('respects the validated 2.0x threshold constant exactly', () => {
    expect(SOURCE_FAMILY_CONFLICT_RATIO).toBe(2.0);
    expect(detectSourceFamilyConflict([
      { subCategory: 'a', priceEur: 10 },
      { subCategory: 'b', priceEur: 19.99 }
    ])).toBeNull(); // 1.999x, just under
    expect(detectSourceFamilyConflict([
      { subCategory: 'a', priceEur: 10 },
      { subCategory: 'b', priceEur: 20 }
    ])).not.toBeNull(); // exactly 2.0x
  });

  it('returns null for fewer than 2 valid prices', () => {
    expect(detectSourceFamilyConflict([])).toBeNull();
    expect(detectSourceFamilyConflict([{ subCategory: 'a', priceEur: 10 }])).toBeNull();
    expect(detectSourceFamilyConflict([
      { subCategory: 'a', priceEur: 10 },
      { subCategory: 'b', priceEur: 0 }
    ])).toBeNull();
  });

  it('flags uncorroborated extreme conflict in detectPricingError', () => {
    // Uncorroborated extreme conflict surfaces as SOURCE_FAMILY_CONFLICT
    const result = detectPricingError({
      priceEur: 0.46,
      otherFreshPricesEur: [8.01, 8.50, 9.00], // non-matching peers
      sourceFamilyConflict: { ratio: 17.41, details: 'keyshops=€0.46 vs official=€8.01 (17.41x)' }
    });
    expect(result.isLikelyPricingError).toBe(true);
    expect(result.type).toBe('SOURCE_FAMILY_CONFLICT');
  });

  it('multi-store corroboration override suppresses SOURCE_FAMILY_CONFLICT and MARKET_OUTLIER', () => {
    // When 2+ independent stores offer close prices (+/- 1.50 EUR or 15-20%), the deal is authenticated
    const result = detectPricingError({
      priceEur: 0.46,
      otherFreshPricesEur: [0.45, 0.47, 0.46], // multi-store corroboration
      sourceFamilyConflict: { ratio: 17.41, details: 'keyshops=€0.46 vs official=€8.01 (17.41x)' }
    });
    expect(result.isLikelyPricingError).toBe(false);
    expect(result.type).toBeNull();
  });
});

describe('ADR-2: checkOverMsrp (informational, non-scoring)', () => {
  it('flags real above-MSRP offers found in production data', () => {
    expect(checkOverMsrp(64.90, 59.99)).toBe(true);   // Ghost of Tsushima DC
    expect(checkOverMsrp(156.62, 79.99)).toBe(true);  // Call of Duty: Black Ops 6
    expect(checkOverMsrp(92.49, 79.99)).toBe(true);   // DOOM: The Dark Ages
  });

  it('does NOT flag prices at or slightly under MSRP', () => {
    expect(checkOverMsrp(59.99, 59.99)).toBe(false);
    expect(checkOverMsrp(55.00, 59.99)).toBe(false);
  });

  it('tolerates small FX/rounding drift within OVER_MSRP_TOLERANCE', () => {
    expect(OVER_MSRP_TOLERANCE).toBe(1.05);
    expect(checkOverMsrp(61.00, 59.99)).toBe(false); // 1.7% over, within 5% tolerance
    expect(checkOverMsrp(63.50, 59.99)).toBe(true);  // 5.9% over, outside tolerance
  });

  it('never triggers with missing or invalid MSRP', () => {
    expect(checkOverMsrp(100, undefined)).toBe(false);
    expect(checkOverMsrp(100, 0)).toBe(false);
    expect(checkOverMsrp(100, -10)).toBe(false);
  });

  it('NEVER contributes to isLikelyPricingError or confidence', () => {
    // A clean, corroborated, over-MSRP price must stay non-error — isOverMsrp
    // is informational only, per the PricingErrorEvaluation doc comment.
    const result = detectPricingError({
      priceEur: 156.62,
      steamBasePriceEur: 79.99,
      otherFreshPricesEur: [155.00, 158.00] // corroborated
    });
    expect(result.isLikelyPricingError).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.isOverMsrp).toBe(true);
  });

  it('surfaces as a riskFlag through evaluatePriceMovement without changing riskLevel', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 156.62,
      basePriceEur: 79.99,
      marketPricesEur: [155.00, 158.00],
      independentMerchantCount: 2
    });
    expect(res.riskFlags).toContain('OVER_MSRP');
    expect(res.riskLevel).toBe('SAFE');
    expect(res.isLikelyPricingError).toBe(false);
  });
});

describe('ADR-1 through evaluatePriceMovement (full pipeline)', () => {
  it('produces a distinct SOURCE_FAMILY_CONFLICT summary and HIGH risk level', () => {
    const res = evaluatePriceMovement({
      currentPriceEur: 0.46,
      sourceFamilyConflict: { ratio: 17.41, details: 'keyshops=€0.46 vs official=€8.01 (17.41x)' }
    });
    expect(res.riskLevel).toBe('HIGH');
    expect(res.riskFlags).toContain('SOURCE_FAMILY_CONFLICT');
    expect(res.summary).toBe('⚠️ Source Reports Conflicting Prices — Verify Manually');
  });
});

describe('Metadata Anomalies under Corroboration (FAKE_BASELINE & EDITION_INVERSION)', () => {
  it('does NOT silence FAKE_BASELINE even when selling price is corroborated by multiple peers', () => {
    // Selling price is 20.00 EUR across 3 stores (corroborated), but store claims original was 150 EUR vs Steam base 40 EUR
    const result = detectPricingError({
      priceEur: 20.00,
      claimedOriginalPriceEur: 150.00,
      steamBasePriceEur: 40.00,
      independentMerchantCount: 3,
      otherFreshPricesEur: [19.99, 20.01]
    });

    expect(result.type).toBe('FAKE_BASELINE');
    expect(result.isLikelyPricingError).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.30);
    expect(result.reason).toContain('Claimed original price (€150.00) is inflated >1.5x');
  });

  it('does NOT silence EDITION_INVERSION even when selling price is corroborated by multiple peers', () => {
    // Deluxe edition priced at 15.00 EUR across 3 stores, but base game is 45.00 EUR
    const result = detectPricingError({
      priceEur: 15.00,
      steamBasePriceEur: 45.00,
      suspectedEditionInversion: true,
      independentMerchantCount: 3,
      otherFreshPricesEur: [14.99, 15.01]
    });

    expect(result.type).toBe('EDITION_INVERSION');
    expect(result.isLikelyPricingError).toBe(true);
    expect(result.confidence).toBe(0.35);
  });
});

describe('SOURCE_FAMILY_CONFLICT Calibration & Known ATL Resilience', () => {
  it('does NOT flag legitimate keyshop prices at or above historical low (Divinity II: 3.18 vs 19.99)', () => {
    const result = detectPricingError({
      priceEur: 3.18,
      steamBasePriceEur: 19.99,
      confirmedAtlEur: 1.99,
      otherFreshPricesEur: [19.99],
      sourceFamilyConflict: { ratio: 6.286, details: 'keyshops=€3.18 vs official=€19.99 (6.29x)' }
    });
    expect(result.isLikelyPricingError).toBe(false);
    expect(result.type).toBeNull();
  });

  it('does NOT flag legitimate keyshop prices at or above historical low (Witchblood: 1.55 vs 9.99)', () => {
    const result = detectPricingError({
      priceEur: 1.55,
      steamBasePriceEur: 9.99,
      confirmedAtlEur: 1.55,
      otherFreshPricesEur: [9.99],
      sourceFamilyConflict: { ratio: 6.445, details: 'keyshops=€1.55 vs official=€9.99 (6.45x)' }
    });
    expect(result.isLikelyPricingError).toBe(false);
    expect(result.type).toBeNull();
  });

  it('does NOT flag legitimate deep keyshop discounts when ratio < 12.0x with confirmed ATL', () => {
    const result = detectPricingError({
      priceEur: 3.50,
      steamBasePriceEur: 19.99,
      confirmedAtlEur: 3.50,
      otherFreshPricesEur: [19.99],
      sourceFamilyConflict: { ratio: 5.71, details: 'keyshops=€3.50 vs official=€19.99 (5.71x)' }
    });
    expect(result.isLikelyPricingError).toBe(false);
    expect(result.type).toBeNull();
  });

  it('flags uncorroborated extreme ratio >= 12.0x when price is below known ATL or without ATL', () => {
    const result = detectPricingError({
      priceEur: 1.86,
      steamBasePriceEur: 29.99,
      otherFreshPricesEur: [25.99],
      sourceFamilyConflict: { ratio: 13.97, details: 'keyshops=€1.86 vs official=€25.99 (13.97x)' }
    });
    expect(result.isLikelyPricingError).toBe(true);
    expect(result.type).toBe('SOURCE_FAMILY_CONFLICT');
  });

  it('flags uncorroborated sub-euro glitch with ratio >= 3.0x (Minecraft Legends: 0.74 vs 18.90)', () => {
    const result = detectPricingError({
      priceEur: 0.74,
      steamBasePriceEur: 39.99,
      otherFreshPricesEur: [18.90],
      sourceFamilyConflict: { ratio: 25.54, details: 'keyshops=€0.74 vs official=€18.90 (25.54x)' }
    });
    expect(result.isLikelyPricingError).toBe(true);
    expect(result.type).toBe('SOURCE_FAMILY_CONFLICT');
  });
});

