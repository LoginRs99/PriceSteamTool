import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/server/db/schema.js';
import { getDb, closeDb, gameRepo, merchantRepo, offerRepo } from '../../src/server/db/index.js';
import { config } from '../../src/server/config/index.js';
import { BEST_DEAL_RECOMPUTE_ALL_SQL } from '../../src/server/db/core.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('Best Deal Tie-Breaker Priority (Official Store vs Keyshop)', () => {
  const originalDbPath = config.dbPath;
  const testDbPath = path.join(os.tmpdir(), `tie_breaker_test_${Date.now()}.db`);

  beforeEach(() => {
    config.dbPath = testDbPath;
    closeDb();
    const db = getDb();
    db.exec(SCHEMA_SQL);
  });

  afterEach(() => {
    closeDb();
    config.dbPath = originalDbPath;
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
      if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
    } catch {}
  });

  it('selects official store over keyshop when prices are tied, even if keyshop was observed more recently', () => {
    const db = getDb();

    // 1. Insert test game
    gameRepo.upsert({
      steamAppId: 999001,
      title: 'The Unfinished Swan',
      slug: 'the-unfinished-swan',
      basePriceEur: 12.99
    });
    const game = gameRepo.getBySteamAppId(999001)!;

    // 2. Insert two merchants: Official (Fanatical) and Keyshop (Kinguin)
    const officialMerchant = merchantRepo.getOrCreate('fanatical', 'Fanatical', true);
    const keyshopMerchant = merchantRepo.getOrCreate('kinguin', 'Kinguin', false);

    // 3. Official offer: €2.76, observed 1 hour ago
    const officialOffer = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: officialMerchant.id,
      productType: 'GAME',
      regionType: 'GLOBAL',
      priceEur: 2.76,
      dealUrl: 'https://fanatical.com/game',
      sourceCode: 'ggdeals'
    });

    // 4. Keyshop offer: €2.76 (TIED PRICE), observed 5 minutes ago (MORE RECENT)
    const keyshopOffer = offerRepo.upsertOffer({
      gameId: game.id,
      merchantId: keyshopMerchant.id,
      productType: 'GAME',
      regionType: 'GLOBAL',
      priceEur: 2.76,
      dealUrl: 'https://kinguin.net/game',
      sourceCode: 'ggdeals'
    });

    // Artificially make keyshop last_observed_at MORE RECENT than official offer
    const dbInst = getDb();
    dbInst.prepare(`UPDATE offers SET last_observed_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 3600000).toISOString(), officialOffer.id);
    dbInst.prepare(`UPDATE offers SET last_observed_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 300000).toISOString(), keyshopOffer.id);

    // Recompute single game best deal
    offerRepo.recomputeBestDealForGame(game.id);

    const winningSingle = db.prepare(`SELECT id, merchant_id, is_best_deal FROM offers WHERE game_id = ? AND is_best_deal = 1`).get(game.id) as any;
    expect(winningSingle).toBeDefined();
    expect(winningSingle.merchant_id).toBe(officialMerchant.id);
    expect(winningSingle.id).toBe(officialOffer.id);

    // Recompute all games batch SQL
    db.exec(BEST_DEAL_RECOMPUTE_ALL_SQL);

    const winningBatch = db.prepare(`SELECT id, merchant_id, is_best_deal FROM offers WHERE game_id = ? AND is_best_deal = 1`).get(game.id) as any;
    expect(winningBatch).toBeDefined();
    expect(winningBatch.merchant_id).toBe(officialMerchant.id);
    expect(winningBatch.id).toBe(officialOffer.id);

    // Startup recomputation path (offerRepo.recomputeAllBestDeals)
    offerRepo.recomputeAllBestDeals();
    const winningStartup = db.prepare(`SELECT id, merchant_id, is_best_deal FROM offers WHERE game_id = ? AND is_best_deal = 1`).get(game.id) as any;
    expect(winningStartup).toBeDefined();
    expect(winningStartup.merchant_id).toBe(officialMerchant.id);
    expect(winningStartup.id).toBe(officialOffer.id);
  });
});
