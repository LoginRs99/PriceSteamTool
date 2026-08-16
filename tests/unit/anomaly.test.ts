import { describe, it, expect } from 'vitest';
import { evaluateOfferAnomaly } from '../../src/server/domain/anomaly.js';

describe('Anomaly Detection Engine — Comprehensive Audit Suite', () => {
  it('does not flag legitimate deep discounts on verified official stores', () => {
    const res = evaluateOfferAnomaly({
      priceEur: 14.99,
      basePriceEur: 59.99,
      originalPriceEur: 59.99,
      isOfficial: true,
      otherPrices: [14.99, 19.99, 24.99, 59.99]
    });

    expect(res.isAnomaly).toBe(false);
    expect(res.score).toBe(0.0);
  });

  it('does NOT flag legitimate new historical lows as errors', () => {
    // Previous historical low was €19.99, new deal is €14.50
    const res = evaluateOfferAnomaly({
      priceEur: 14.50,
      basePriceEur: 59.99,
      historicalLowEur: 19.99,
      isOfficial: true,
      otherPrices: [14.50, 16.00, 18.00]
    });

    expect(res.isAnomaly).toBe(false);
  });

  it('flags extreme sub-euro price on high-MSRP title from unofficial keyshop', () => {
    const res = evaluateOfferAnomaly({
      priceEur: 0.79,
      basePriceEur: 59.99,
      isOfficial: false,
      otherPrices: [59.99, 49.99, 45.00]
    });

    expect(res.isAnomaly).toBe(true);
    expect(res.score).toBeGreaterThan(0.7);
    expect(res.type).toBe('EXTREME_DISCOUNT');
    expect(res.reason).toContain('Suspiciously low');
  });

  it('flags severe market median discrepancy', () => {
    // Median is ~€40, unverified listing is €3.50
    const res = evaluateOfferAnomaly({
      priceEur: 3.50,
      basePriceEur: 49.99,
      isOfficial: false,
      otherPrices: [39.99, 38.50, 42.00, 40.00]
    });

    expect(res.isAnomaly).toBe(true);
    expect(res.type).toBe('UNVERIFIED_MERCHANT_DISCREPANCY');
    expect(res.reason).toContain('median');
  });
});

import { gameRepo, merchantRepo, offerRepo, anomalyRepo, getDb } from '../../src/server/db/index.js';

describe('Data Safety — Write-Time Anomaly Recording & Deduplication', () => {
  function resetDb() {
    const db = getDb();
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DELETE FROM anomalies;
      DELETE FROM offers;
      DELETE FROM games;
      DELETE FROM merchants;
      PRAGMA foreign_keys = ON;
    `);
  }

  it('automatically records a HIGH risk glitch offer into anomalies table upon write-time ingestion', () => {
    resetDb();

    const game = gameRepo.upsert({
      steamAppId: 1091500,
      title: 'Cyberpunk 2077',
      basePriceEur: 59.99
    });
    const steamMerchant = merchantRepo.getOrCreate('steam', 'Steam Store', true);
    const keyshopMerchant = merchantRepo.getOrCreate('unknown_keyshop', 'Shady Keys', false);

    // Baseline official offer
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: steamMerchant.id,
      productType: 'DIRECT_PURCHASE',
      regionType: 'GLOBAL',
      priceEur: 59.99,
      dealUrl: 'https://store.steampowered.com/app/1091500',
      isValid: true,
      sourceCode: 'steam'
    });

    // Extreme sub-euro glitch keyshop offer (0.49€ on 59.99€ game)
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: keyshopMerchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.49,
      dealUrl: 'https://gg.deals/deal/12345',
      isValid: true,
      sourceCode: 'ggdeals'
    });

    const activeAnomalies = anomalyRepo.list(true);
    expect(activeAnomalies.length).toBe(1);
    expect(activeAnomalies[0].gameId).toBe(game.id);
    expect(activeAnomalies[0].merchantName).toBe('Shady Keys');
    expect(activeAnomalies[0].priceEur).toBe(0.49);
    expect(activeAnomalies[0].anomalyType).toBe('SUB_EURO_PREMIUM_GLITCH');
    expect(activeAnomalies[0].score).toBeGreaterThanOrEqual(0.70);
    expect(activeAnomalies[0].isDismissed).toBe(false);
  });

  it('deduplicates recurring anomalies across repeated sync cycles without creating duplicate rows', () => {
    resetDb();

    const game = gameRepo.upsert({
      steamAppId: 12345,
      title: 'Glitch Game',
      basePriceEur: 49.99
    });
    const keyshopMerchant = merchantRepo.getOrCreate('keyshop_a', 'Keyshop A', false);

    // First sync iteration
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: keyshopMerchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.30,
      dealUrl: 'https://allkeyshop.com/offer/1',
      isValid: true,
      sourceCode: 'allkeyshop'
    });

    let anomalies = anomalyRepo.list(true);
    expect(anomalies.length).toBe(1);
    const originalAnomalyId = anomalies[0].id;

    // Second sync iteration (re-ingesting same active anomaly)
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: keyshopMerchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.30,
      dealUrl: 'https://allkeyshop.com/offer/1',
      isValid: true,
      sourceCode: 'allkeyshop'
    });

    anomalies = anomalyRepo.list(true);
    expect(anomalies.length).toBe(1);
    expect(anomalies[0].id).toBe(originalAnomalyId);

    // Third iteration: manual dismiss
    anomalyRepo.dismiss(originalAnomalyId);
    expect(anomalyRepo.list(true).length).toBe(0);
    expect(anomalyRepo.list(false).length).toBe(1);
    expect(anomalyRepo.list(false)[0].isDismissed).toBe(true);
  });
});

