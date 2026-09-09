import { describe, it, expect, beforeEach } from 'vitest';
import { prepareStmt, getDb } from '../../src/server/db/core.js';
import { gameRepo } from '../../src/server/db/repositories/game.js';
import { merchantRepo } from '../../src/server/db/repositories/merchant.js';
import { offerRepo } from '../../src/server/db/repositories/offer.js';
import { anomalyRepo } from '../../src/server/db/repositories/anomaly.js';
import { calculatePriceRisk } from '../../src/server/domain/pricingEngine/riskEvaluator.js';
import { evaluatePriceMovement } from '../../src/server/domain/pricingEngine/evaluator.js';

function resetDb() {
  const db = getDb();
  db.exec(`
    DELETE FROM anomalies;
    DELETE FROM source_observations;
    DELETE FROM price_history;
    DELETE FROM offers;
    DELETE FROM games;
  `);
}

describe('Data Safety & Outlier Detection Refinement Suite', () => {
  beforeEach(() => {
    resetDb();
  });

  it('RULE 1: Price increases are NEVER anomalies or high risk', () => {
    const flags = new Set<any>();
    const risk = calculatePriceRisk({
      currentPriceEur: 12.99,
      previousPriceEur: 4.99,
      basePriceEur: 59.99,
      marketPricesEur: [15.00, 20.00],
      sourceAgreementCount: 1,
      isOfficialMerchant: false
    }, flags);

    expect(risk.riskLevel).toBe('SAFE');
    expect(risk.riskScore).toBe(0.0);

    const movement = evaluatePriceMovement({
      currentPriceEur: 12.99,
      previousPriceEur: 4.99,
      basePriceEur: 59.99,
      marketPricesEur: [15.00, 20.00],
      sourceAgreementCount: 1,
      isOfficialMerchant: false
    });

    expect(movement.event).toBe('PRICE_INCREASE');
    expect(movement.riskLevel).toBe('SAFE');
    expect(movement.isAnomaly).toBe(false);
    expect(movement.summary).toBe('📈 Price Increased');
  });

  it('RULE 2: An offer is NEVER an outlier if another active store is cheaper', () => {
    const flags = new Set<any>();
    const risk = calculatePriceRisk({
      currentPriceEur: 10.00,
      previousPriceEur: 40.00,
      basePriceEur: 49.99,
      marketPricesEur: [3.00, 15.00, 20.00],
      sourceAgreementCount: 1,
      isOfficialMerchant: false
    }, flags);

    expect(risk.riskLevel).toBe('SAFE');
    expect(risk.riskScore).toBe(0.0);
    expect(flags.has('LONE_BOTTOM_OUTLIER')).toBe(false);
    expect(flags.has('SUB_EURO_PREMIUM_GLITCH')).toBe(false);

    const movement = evaluatePriceMovement({
      currentPriceEur: 10.00,
      previousPriceEur: 40.00,
      basePriceEur: 49.99,
      marketPricesEur: [3.00, 15.00, 20.00],
      sourceAgreementCount: 1,
      isOfficialMerchant: false
    });

    expect(movement.riskLevel).toBe('SAFE');
    expect(movement.isAnomaly).toBe(false);
    expect(movement.summary).not.toContain('High Risk Anomaly');
  });

  it('RULE 3: End-to-end repository test: More expensive offer (e.g. Steam Gift) is not flagged when cheaper key exists', () => {
    const game = gameRepo.upsert({
      steamAppId: 54321,
      title: 'Pillars of Integrity',
      basePriceEur: 49.99
    });

    const storeA = merchantRepo.getOrCreate('kinguin', 'Kinguin', false);
    const storeB = merchantRepo.getOrCreate('wyrel', 'Wyrel', false);

    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: storeA.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 2.82,
      originalPriceEur: 49.99,
      sourceCode: 'allkeyshop',
      dealUrl: 'https://kinguin.com/deal'
    });

    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: storeB.id,
      productType: 'STEAM_GIFT',
      regionType: 'EU',
      priceEur: 6.35,
      originalPriceEur: 49.99,
      sourceCode: 'ggdeals',
      dealUrl: 'https://wyrel.com/gift'
    });

    const offers = offerRepo.getOffersForGame(game.id);
    const wyrelOffer = offers.find(o => o.merchantId === storeB.id)!;

    expect(wyrelOffer.isAnomaly).toBe(false);
    expect(wyrelOffer.riskLevel).toBe('SAFE');

    const anomalies = anomalyRepo.list(true);
    expect(anomalies.some(a => a.offerId === wyrelOffer.id)).toBe(false);
  });

  it('RULE 4: True bottom outlier is detected and gets clean, descriptive reason', () => {
    const game = gameRepo.upsert({
      steamAppId: 99001,
      title: 'Real Outlier Game',
      basePriceEur: 59.99
    });

    const legitStore = merchantRepo.getOrCreate('steam', 'Steam Store', true);
    const sketchyStore = merchantRepo.getOrCreate('sketchy', 'Sketchy Shop', false);

    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: legitStore.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 29.99,
      originalPriceEur: 59.99,
      sourceCode: 'steam',
      dealUrl: 'https://store.steampowered.com/99001'
    });

    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: sketchyStore.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.49,
      originalPriceEur: 59.99,
      sourceCode: 'ggdeals',
      dealUrl: 'https://sketchy.com/glitch'
    });

    const offers = offerRepo.getOffersForGame(game.id);
    const glitchOffer = offers.find(o => o.merchantId === sketchyStore.id)!;

    expect(glitchOffer.isAnomaly).toBe(true);
    expect(glitchOffer.riskLevel).toBe('HIGH');
    expect(glitchOffer.anomalyReason).toContain('Sub-Euro Price Glitch');

    const anomalies = anomalyRepo.list(true);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].gameTitle).toBe('Real Outlier Game');
    expect(anomalies[0].priceEur).toBe(0.49);
    expect(anomalies[0].reason).toContain('Sub-Euro Price Glitch');
  });

  it('RULE 5: getOffersForGame sorts strictly by price ASC (cheapest at the top)', () => {
    const game = gameRepo.upsert({
      steamAppId: 77777,
      title: 'Sorting Test Game',
      basePriceEur: 39.99
    });

    const m1 = merchantRepo.getOrCreate('m1', 'Expensive Store', true);
    const m2 = merchantRepo.getOrCreate('m2', 'Cheapest Glitch Store', false);
    const m3 = merchantRepo.getOrCreate('m3', 'Mid Store', true);

    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: m1.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 35.00,
      dealUrl: 'https://steam.example/35',
      sourceCode: 'steam'
    });

    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: m3.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 18.00,
      dealUrl: 'https://cheapshark.example/18',
      sourceCode: 'cheapshark'
    });

    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: m2.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 2.50,
      dealUrl: 'https://aks.example/2.50',
      sourceCode: 'allkeyshop'
    });

    const offers = offerRepo.getOffersForGame(game.id);
    expect(offers.length).toBe(3);

    expect(offers[0].priceEur).toBe(2.50);
    expect(offers[0].merchantName).toBe('Cheapest Glitch Store');
    expect(offers[0].isBestDeal).toBe(true);

    expect(offers[1].priceEur).toBe(18.00);
    expect(offers[2].priceEur).toBe(35.00);
  });

  it('RULE 6: Official seasonal sales on classic catalog titles (e.g. Hitman Contracts €8.99 -> €0.89) are SAFE and not anomalies', () => {
    const flags = new Set<any>();
    const risk = calculatePriceRisk({
      currentPriceEur: 0.89,
      basePriceEur: 8.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 1,
      marketPricesEur: []
    }, flags);

    expect(risk.riskLevel).toBe('SAFE');
    expect(flags.has('SUB_EURO_PREMIUM_GLITCH')).toBe(false);

    const movement = evaluatePriceMovement({
      currentPriceEur: 0.89,
      basePriceEur: 8.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 1,
      marketPricesEur: []
    });

    expect(movement.riskLevel).toBe('SAFE');
    expect(movement.isAnomaly).toBe(false);
    expect(movement.summary).not.toContain('⚡ Sub-Euro Price Glitch');
  });

  it('RULE 7: Genuine pricing error on AAA game (e.g. €59.99 -> €0.89) remains HIGH risk anomaly', () => {
    const flags = new Set<any>();
    const risk = calculatePriceRisk({
      currentPriceEur: 0.89,
      basePriceEur: 59.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 1,
      marketPricesEur: [45.00]
    }, flags);

    expect(risk.riskLevel).toBe('HIGH');
    expect(flags.has('SUB_EURO_PREMIUM_GLITCH')).toBe(true);

    const movement = evaluatePriceMovement({
      currentPriceEur: 0.89,
      basePriceEur: 59.99,
      isOfficialMerchant: true,
      sourceAgreementCount: 1,
      marketPricesEur: [45.00]
    });

    expect(movement.riskLevel).toBe('HIGH');
    expect(movement.isAnomaly).toBe(true);
    expect(movement.summary).toContain('⚡ Sub-Euro Price Glitch');
  });
});
