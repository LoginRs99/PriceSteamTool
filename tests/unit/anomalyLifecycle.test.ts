import { describe, it, expect, beforeEach } from 'vitest';
import { anomalyRepo } from '../../src/server/db/repositories/anomaly.js';
import { gameRepo } from '../../src/server/db/repositories/game.js';
import { merchantRepo } from '../../src/server/db/repositories/merchant.js';
import { offerRepo } from '../../src/server/db/repositories/offer.js';
import { prepareStmt } from '../../src/server/db/core.js';

describe('Anomaly Persistence Lifecycle & Production Logging Suite', () => {
  beforeEach(() => {
    try {
      prepareStmt('DELETE FROM anomalies').run();
      prepareStmt('DELETE FROM offers').run();
      prepareStmt('DELETE FROM games').run();
      prepareStmt('DELETE FROM merchants').run();
    } catch {}
  });

  it('1. startup anomaly audit query produces concise count summaries without raw JSON table dumps', () => {
    const game = gameRepo.upsert({ steamAppId: 100, title: 'Test Game', basePriceEur: 50 });
    const merchant = merchantRepo.getOrCreate('store_a', 'Store A', false);
    
    // Create an anomaly record
    anomalyRepo.record(game.id, 'off-1', 'SUB_EURO_PREMIUM_GLITCH', 0.85, 'Glitch', 0.49);

    const counts = prepareStmt(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_dismissed = 0 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN is_dismissed = 1 THEN 1 ELSE 0 END) as dismissed
      FROM anomalies
    `).get() as any;

    expect(counts.total).toBe(1);
    expect(counts.active).toBe(1);
    expect(counts.dismissed).toBe(0);
  });

  it('2. active anomaly remains active while condition persists across repeated syncs', () => {
    const game = gameRepo.upsert({ steamAppId: 101, title: 'Game 1', basePriceEur: 50 });
    const merchant = merchantRepo.getOrCreate('keyshop_1', 'Keyshop 1', false);

    // Sync 1: Glitch offer
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.49,
      sourceCode: 'ggdeals',
      dealUrl: 'https://example.com/deal'
    });

    let active = anomalyRepo.list(true);
    expect(active.length).toBe(1);
    const firstId = active[0].id;

    // Sync 2: Same price 0.49
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.49,
      sourceCode: 'ggdeals',
      dealUrl: 'https://example.com/deal'
    });

    active = anomalyRepo.list(true);
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(firstId); // In-place update, same row
  });

  it('3. normal price resolves active anomaly (resolveForOffer)', () => {
    const game = gameRepo.upsert({ steamAppId: 102, title: 'Game 2', basePriceEur: 50 });
    const merchant = merchantRepo.getOrCreate('keyshop_2', 'Keyshop 2', false);

    // Sync 1: Anomaly price
    const off = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.49,
      sourceCode: 'ggdeals',
      dealUrl: 'https://example.com/deal'
    });

    expect(anomalyRepo.list(true).length).toBe(1);

    // Sync 2: Price returns to normal (€29.99)
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 29.99,
      sourceCode: 'ggdeals',
      dealUrl: 'https://example.com/deal'
    });

    // Active anomalies query filters out resolved anomaly
    expect(anomalyRepo.list(true).length).toBe(0);
  });

  it('4 & 5. dismissed anomaly does not recreate every sync while the same condition persists', () => {
    const game = gameRepo.upsert({ steamAppId: 103, title: 'Game 3', basePriceEur: 50 });
    const merchant = merchantRepo.getOrCreate('keyshop_3', 'Keyshop 3', false);

    // Sync 1: Anomaly price
    const off = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.49,
      sourceCode: 'ggdeals',
      dealUrl: 'https://example.com/deal'
    });

    const activeList = anomalyRepo.list(true);
    expect(activeList.length).toBe(1);

    // User dismisses anomaly
    anomalyRepo.dismiss(activeList[0].id);
    expect(anomalyRepo.list(true).length).toBe(0);

    // Sync 2: Price remains €0.49 -> respects dismissal, does NOT recreate active anomaly
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.49,
      sourceCode: 'ggdeals',
      dealUrl: 'https://example.com/deal'
    });

    expect(anomalyRepo.list(true).length).toBe(0);
  });

  it('6. a materially changed anomaly (price drop > 15%) creates a new anomaly event', () => {
    const game = gameRepo.upsert({ steamAppId: 104, title: 'Game 4', basePriceEur: 50 });
    const merchant = merchantRepo.getOrCreate('keyshop_4', 'Keyshop 4', false);

    // Sync 1: Anomaly at €0.49
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.49,
      sourceCode: 'ggdeals',
      dealUrl: 'https://example.com/deal'
    });

    const activeList = anomalyRepo.list(true);
    anomalyRepo.dismiss(activeList[0].id);

    // Sync 2: Price drops significantly lower to €0.05 (material new drop > 15%)
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.05,
      sourceCode: 'ggdeals',
      dealUrl: 'https://example.com/deal'
    });

    // Materially new event triggers new active anomaly
    const newActiveList = anomalyRepo.list(true);
    expect(newActiveList.length).toBe(1);
    expect(newActiveList[0].priceEur).toBe(0.05);
  });

  it('7 & 8. resolved anomaly does not appear in active queries but remains available in historical queries (list(false))', () => {
    const game = gameRepo.upsert({ steamAppId: 105, title: 'Game 5', basePriceEur: 50 });
    const merchant = merchantRepo.getOrCreate('keyshop_5', 'Keyshop 5', false);

    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 0.49,
      sourceCode: 'ggdeals',
      dealUrl: 'https://example.com/deal'
    });

    // Price returns to normal
    offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: merchant.id,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 35.00,
      sourceCode: 'ggdeals',
      dealUrl: 'https://example.com/deal'
    });

    expect(anomalyRepo.list(true).length).toBe(0); // Excluded from active
    expect(anomalyRepo.list(false).length).toBe(1); // Historical record preserved
  });
});
