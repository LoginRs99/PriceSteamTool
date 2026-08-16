import { describe, it, expect } from 'vitest';
import { evaluatePriceMovement } from '../../src/server/domain/pricingEngine.js';
import { calculateDealScore } from '../../src/server/domain/dealScore.js';
import { generatePriceIntelligence } from '../../src/server/domain/priceIntelligence.js';
import type { Game, Offer, PriceHistoryEntry } from '../../src/shared/types.js';

describe('v1.0 – v1.3 Production-Readiness & Real-Data Audit Suite', () => {

  it('1. BUY / FAIR / WAIT produces realistic decisions across AAA, Indie, and Legacy titles', () => {
    // Game A: Witcher 3 (Legacy title on 85% discount, matches ATL)
    const witcher: Game = {
      id: 'g-witcher',
      steamAppId: 292030,
      title: 'The Witcher 3: Wild Hunt',
      slug: 'the-witcher-3-wild-hunt',
      basePriceEur: 29.99,
      historicalLowEur: 4.49,
      isDlc: false,
      isFree: false,
      hasAnomaly: false,
      offersCount: 1,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z'
    };
    const witcherOffer: Offer = {
      id: 'o-witcher',
      gameId: 'g-witcher',
      merchantId: 'm-steam',
      merchantCode: 'steam',
      merchantName: 'Steam',
      isOfficial: true,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      regionConfidence: 1.0,
      priceEur: 4.49,
      originalPriceEur: 29.99,
      discountPercent: 85,
      dealUrl: 'https://store.steampowered.com/app/292030',
      isValid: true,
      isBestDeal: true,
      priceEvent: 'AT_HISTORICAL_LOW',
      riskLevel: 'SAFE',
      riskScore: 0,
      riskFlags: [],
      evaluationConfidence: 1.0,
      isAnomaly: false,
      sources: ['steam'],
      sourceAgreementCount: 3,
      dealScore: 95,
      dealTier: 'Exceptional',
      fetchedAt: '2026-08-15T12:00:00Z',
      lastObservedAt: '2026-08-15T12:00:00Z',
      createdAt: '2026-08-15T12:00:00Z',
      updatedAt: '2026-08-15T12:00:00Z'
    };

    const intelWitcher = generatePriceIntelligence({
      game: witcher,
      offers: [witcherOffer],
      history: [{ id: 'ph-1', gameId: 'g-witcher', sourceCode: 'steam', priceEur: 4.49, recordedAt: '2026-08-10T00:00:00Z' }]
    });

    expect(intelWitcher.advice.decision).toBe('BUY');
    expect(intelWitcher.advice.confidence).toBe('HIGH');
    expect(intelWitcher.advice.headline).toBe('Exceptional Buying Opportunity');

    // Game B: Factorio (Never discounts, at full MSRP)
    const factorio: Game = {
      id: 'g-factorio',
      steamAppId: 427520,
      title: 'Factorio',
      slug: 'factorio',
      basePriceEur: 32.00,
      historicalLowEur: 32.00,
      isDlc: false,
      isFree: false,
      hasAnomaly: false,
      offersCount: 1,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z'
    };
    const factorioOffer: Offer = {
      ...witcherOffer,
      id: 'o-factorio',
      gameId: 'g-factorio',
      priceEur: 32.00,
      originalPriceEur: 32.00,
      discountPercent: 0,
      priceEvent: 'NONE',
      dealScore: 20,
      dealTier: 'Weak'
    };

    const intelFactorio = generatePriceIntelligence({
      game: factorio,
      offers: [factorioOffer],
      history: []
    });

    expect(intelFactorio.advice.decision).toBe('WAIT');
  });

  it('2. Standard 10-20% minor discount is evaluated as FAIR or WAIT, avoiding false BUY', () => {
    const game: Game = {
      id: 'g-cyberpunk',
      steamAppId: 1091500,
      title: 'Cyberpunk 2077',
      slug: 'cyberpunk-2077',
      basePriceEur: 59.99,
      historicalLowEur: 29.99,
      isDlc: false,
      isFree: false,
      hasAnomaly: false,
      offersCount: 1,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z'
    };

    // Minor 15% discount to €50.99
    const minorOffer: Offer = {
      id: 'o-cp',
      gameId: 'g-cyberpunk',
      merchantId: 'm-steam',
      merchantCode: 'steam',
      merchantName: 'Steam',
      isOfficial: true,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      regionConfidence: 1.0,
      priceEur: 50.99,
      originalPriceEur: 59.99,
      discountPercent: 15,
      dealUrl: 'https://store.steampowered.com/app/1091500',
      isValid: true,
      isBestDeal: true,
      priceEvent: 'STANDARD_SALE',
      riskLevel: 'SAFE',
      riskScore: 0,
      riskFlags: [],
      evaluationConfidence: 0.90,
      isAnomaly: false,
      sources: ['steam'],
      sourceAgreementCount: 2,
      dealScore: 42,
      dealTier: 'Fair',
      fetchedAt: '2026-08-15T12:00:00Z',
      lastObservedAt: '2026-08-15T12:00:00Z',
      createdAt: '2026-08-15T12:00:00Z',
      updatedAt: '2026-08-15T12:00:00Z'
    };

    const intel = generatePriceIntelligence({
      game,
      offers: [minorOffer],
      history: [
        { id: 'ph-1', gameId: 'g-cyberpunk', sourceCode: 'steam', priceEur: 29.99, recordedAt: '2025-11-01T00:00:00Z' },
        { id: 'ph-2', gameId: 'g-cyberpunk', sourceCode: 'steam', priceEur: 29.99, recordedAt: '2025-12-01T00:00:00Z' }
      ]
    });

    // Typical sale is 29.99; at 50.99 it is way above typical sale -> WAIT!
    expect(intel.advice.decision).toBe('WAIT');
    expect(intel.advice.headline).toBe('Wait for Better Discount');
  });

  it('3. Legitimate 85-90% official deep sale is SAFE and never flagged as anomaly', () => {
    const evalRes = evaluatePriceMovement({
      currentPriceEur: 4.49,
      basePriceEur: 29.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 2,
      marketPricesEur: [4.49, 5.99]
    });

    expect(evalRes.event).toBe('EXTREME_DROP');
    expect(evalRes.riskLevel).toBe('SAFE');
    expect(evalRes.isAnomaly).toBe(false);

    // Without previous low / typical sale context (pure MSRP fallback): score is 25 (Fallback Cap)
    const dealWithoutAtl = calculateDealScore({
      priceEur: 4.49,
      basePriceEur: 29.99,
      discountPercent: 85,
      priceEvent: evalRes.event,
      isOfficialMerchant: true,
      sourceAgreementCount: 2,
      riskLevel: evalRes.riskLevel,
      evaluationConfidence: evalRes.confidence
    });

    expect(dealWithoutAtl.score).toBe(25);
    expect(dealWithoutAtl.isLowSample).toBe(true);

    // With confirmed ATL & typical sale history: score reaches Exceptional (85+)
    const dealWithAtl = calculateDealScore({
      priceEur: 4.49,
      basePriceEur: 29.99,
      typicalSaleMedianEur: 14.99,
      typicalSaleQ1Eur: 12.99,
      typicalSaleQ3Eur: 17.99,
      discountPercent: 85,
      priceEvent: 'AT_HISTORICAL_LOW',
      allTimeLowEur: 4.49,
      isOfficialMerchant: true,
      sourceAgreementCount: 2,
      riskLevel: evalRes.riskLevel,
      evaluationConfidence: evalRes.confidence
    });

    expect(dealWithAtl.score).toBeGreaterThanOrEqual(80);
    expect(['Great', 'Exceptional']).toContain(dealWithAtl.tier);
  });

  it('4. Sub-Euro unverified outlier glitch is suppressed (capped at 35, WAIT decision)', () => {
    const evalRes = evaluatePriceMovement({
      currentPriceEur: 0.49,
      basePriceEur: 59.99,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      marketPricesEur: [45.00, 50.00]
    });

    expect(evalRes.riskLevel).toBe('HIGH');
    expect(evalRes.isAnomaly).toBe(true);

    const deal = calculateDealScore({
      priceEur: 0.49,
      basePriceEur: 59.99,
      discountPercent: 99,
      priceEvent: evalRes.event,
      isOfficialMerchant: false,
      sourceAgreementCount: 1,
      riskLevel: evalRes.riskLevel,
      evaluationConfidence: evalRes.confidence,
      isAnomaly: evalRes.isAnomaly
    });

    expect(deal.score).toBeLessThanOrEqual(35);

    const game: Game = {
      id: 'g-aaa',
      steamAppId: 12345,
      title: 'AAA Blockbuster',
      slug: 'aaa-blockbuster',
      basePriceEur: 59.99,
      historicalLowEur: 29.99,
      isDlc: false,
      isFree: false,
      hasAnomaly: true,
      offersCount: 1,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z'
    };

    const glitchOffer: Offer = {
      id: 'o-glitch',
      gameId: 'g-aaa',
      merchantId: 'm-shady',
      merchantCode: 'shady',
      merchantName: 'ShadyKeys',
      isOfficial: false,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      regionConfidence: 1.0,
      priceEur: 0.49,
      originalPriceEur: 59.99,
      discountPercent: 99,
      dealUrl: 'https://example.com',
      isValid: true,
      isBestDeal: true,
      priceEvent: evalRes.event,
      riskLevel: evalRes.riskLevel,
      riskScore: evalRes.riskScore,
      riskFlags: evalRes.riskFlags,
      evaluationConfidence: evalRes.confidence,
      isAnomaly: true,
      anomalyReason: 'Extreme pricing glitch',
      sources: ['allkeyshop'],
      sourceAgreementCount: 1,
      dealScore: deal.score,
      dealTier: deal.tier,
      fetchedAt: '2026-08-15T12:00:00Z',
      lastObservedAt: '2026-08-15T12:00:00Z',
      createdAt: '2026-08-15T12:00:00Z',
      updatedAt: '2026-08-15T12:00:00Z'
    };

    const intel = generatePriceIntelligence({
      game,
      offers: [glitchOffer],
      history: []
    });

    expect(intel.advice.decision).toBe('WAIT');
    expect(intel.advice.headline).toBe('High Risk Price Anomaly');
  });

  it('5. Incomplete 30/90/365-day history leaves period low null without fabricating fake low', () => {
    const game: Game = {
      id: 'g-fresh',
      steamAppId: 99999,
      title: 'Freshly Added Indie',
      slug: 'freshly-added-indie',
      basePriceEur: 19.99,
      isDlc: false,
      isFree: false,
      hasAnomaly: false,
      offersCount: 1,
      createdAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
      updatedAt: new Date().toISOString()
    };

    const history: PriceHistoryEntry[] = [
      {
        id: 'ph-1',
        gameId: 'g-fresh',
        sourceCode: 'steam',
        priceEur: 14.99,
        recordedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
      }
    ];

    const intel = generatePriceIntelligence({
      game,
      offers: [],
      history
    });

    expect(intel.periodLows.low7d.priceEur).toBe(14.99);
    expect(intel.periodLows.low30d.priceEur).toBeNull();
    expect(intel.periodLows.low90d.priceEur).toBeNull();
    expect(intel.periodLows.low1y.priceEur).toBeNull();
  });

  it('6. Market comparison correctly filters out restricted regions and incompatible product types', () => {
    const validGlobalOffer: Offer = {
      id: 'o-1',
      gameId: 'g-1',
      merchantId: 'm-steam',
      merchantCode: 'steam',
      merchantName: 'Steam',
      isOfficial: true,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      regionConfidence: 1.0,
      priceEur: 29.99,
      dealUrl: 'https://store.steampowered.com',
      isValid: true,
      isBestDeal: true,
      priceEvent: 'STANDARD_SALE',
      riskLevel: 'SAFE',
      riskScore: 0,
      riskFlags: [],
      evaluationConfidence: 1.0,
      isAnomaly: false,
      sources: ['steam'],
      sourceAgreementCount: 2,
      fetchedAt: '2026-08-15T12:00:00Z',
      lastObservedAt: '2026-08-15T12:00:00Z',
      createdAt: '2026-08-15T12:00:00Z',
      updatedAt: '2026-08-15T12:00:00Z'
    };

    const restrictedOffer: Offer = {
      ...validGlobalOffer,
      id: 'o-2',
      merchantName: 'GeoLocked Seller',
      priceEur: 2.99,
      regionType: 'RESTRICTED',
      riskLevel: 'HIGH'
    };

    const game: Game = {
      id: 'g-1',
      steamAppId: 100,
      title: 'Game 1',
      slug: 'game-1',
      basePriceEur: 39.99,
      isDlc: false,
      isFree: false,
      hasAnomaly: false,
      offersCount: 2,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z'
    };

    const intel = generatePriceIntelligence({
      game,
      offers: [validGlobalOffer, restrictedOffer],
      history: []
    });

    expect(intel.marketComparison.totalCompatibleOffers).toBe(1);
    expect(intel.marketComparison.marketMedianEur).toBe(29.99);
  });
});
