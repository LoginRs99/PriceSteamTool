import { describe, it, expect, beforeEach } from 'vitest';
import { 
  getDb, 
  gameRepo, 
  prepareStmt 
} from '../../src/server/db/index.js';

function resetDatabase() {
  const db = getDb();
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM notifications_log;
    DELETE FROM sync_runs;
    DELETE FROM source_observations;
    DELETE FROM price_history;
    DELETE FROM anomalies;
    DELETE FROM offers;
    DELETE FROM wishlist_entries;
    DELETE FROM games;
    DELETE FROM merchants;
    DELETE FROM profiles;
    PRAGMA foreign_keys = ON;
  `);
}

describe('Dual All-Time Low Invariant Suite (historical_low_eur <= official_historical_low_eur)', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('updates both official and overall ATL when an official low beats previous overall ATL', () => {
    const game = gameRepo.upsert({
      steamAppId: 10001,
      title: 'Invariant Test Game',
      basePriceEur: 49.99
    });

    // Step 1: Overall ATL is 15.00€ from a confirmed keyshop, official ATL is 20.00€
    gameRepo.updateHistoricalLow(game.id, 15.00, '2025-01-01', 'kinguin', { isConfirmed: true });
    gameRepo.updateOfficialHistoricalLow(game.id, 20.00, '2025-01-01', 'steam');

    let row = gameRepo.getById(game.id)!;
    expect(row.historicalLowEur).toBe(15.00);
    expect(row.officialHistoricalLowEur).toBe(20.00);
    expect(row.historicalLowEur!).toBeLessThanOrEqual(row.officialHistoricalLowEur!);

    // Step 2: Official store (e.g. Steam) has a massive sale at 12.00€ (beats keyshop 15.00€)
    gameRepo.updateOfficialHistoricalLow(game.id, 12.00, '2025-02-01', 'steam');

    row = gameRepo.getById(game.id)!;
    // Both official and overall must be updated to 12.00€ atomically
    expect(row.officialHistoricalLowEur).toBe(12.00);
    expect(row.historicalLowEur).toBe(12.00);
    expect(row.historicalLowDate).toBe('2025-02-01');
    expect(row.historicalLowSource).toBe('steam');
    expect(row.atlIsConfirmed).toBe(true);
    expect(row.historicalLowEur!).toBeLessThanOrEqual(row.officialHistoricalLowEur!);
  });

  it('resolves the Shadow Labyrinth anomaly (official 10.93€ vs overall 10.95€)', () => {
    // Reproduce Shadow Labyrinth anomaly state (App ID 1859430)
    const game = gameRepo.upsert({
      steamAppId: 1859430,
      title: 'Shadow Labyrinth',
      basePriceEur: 19.99
    });

    // Seed overall ATL at 10.95€
    gameRepo.updateHistoricalLow(game.id, 10.95, '2025-01-10', 'cdkeys', { isConfirmed: true });

    // Official store price comes in at 10.93€
    gameRepo.updateOfficialHistoricalLow(game.id, 10.93, '2025-01-15', 'steam');

    const row = gameRepo.getById(game.id)!;
    // Invariant must hold: overall must NEVER be 10.95€ when official is 10.93€
    expect(row.officialHistoricalLowEur).toBe(10.93);
    expect(row.historicalLowEur).toBe(10.93);
    expect(row.historicalLowEur!).toBeLessThanOrEqual(row.officialHistoricalLowEur!);
  });

  it('preserves keyshop lower ATL when keyshop beats official store with confirmation', () => {
    const game = gameRepo.upsert({
      steamAppId: 10002,
      title: 'Keyshop Win Game',
      basePriceEur: 59.99
    });

    // Official low is 25.00€
    gameRepo.updateOfficialHistoricalLow(game.id, 25.00, '2025-01-01', 'steam');

    // Unconfirmed single keyshop does NOT overwrite confirmed official ATL
    gameRepo.updateHistoricalLow(game.id, 18.00, '2025-01-05', 'eneba', { isConfirmed: false });
    let row = gameRepo.getById(game.id)!;
    expect(row.officialHistoricalLowEur).toBe(25.00);

    // Confirmed keyshop (e.g. multi-source corroborated) updates overall ATL
    gameRepo.updateHistoricalLow(game.id, 18.00, '2025-01-05', 'eneba', { isConfirmed: true });
    row = gameRepo.getById(game.id)!;
    expect(row.officialHistoricalLowEur).toBe(25.00);
    expect(row.historicalLowEur).toBe(18.00);
    // 18.00 <= 25.00 invariant holds
    expect(row.historicalLowEur!).toBeLessThanOrEqual(row.officialHistoricalLowEur!);
  });

  it('heals invariant discrepancy via reconcileAllHistoricalLows', () => {
    const game = gameRepo.upsert({
      steamAppId: 10004,
      title: 'Corrupted Invariant Game',
      basePriceEur: 39.99
    });

    // Directly corrupt database with an invariant violation
    prepareStmt(`
      UPDATE games 
      SET official_historical_low_eur = 8.50, 
          official_historical_low_date = '2025-01-01',
          official_historical_low_source = 'steam',
          historical_low_eur = 9.99,
          historical_low_date = '2024-12-01',
          historical_low_source = 'g2a'
      WHERE id = ?
    `).run(game.id);

    // Verify corruption is present
    let row = gameRepo.getById(game.id)!;
    expect(row.historicalLowEur).toBe(9.99);
    expect(row.officialHistoricalLowEur).toBe(8.50);
    expect(row.historicalLowEur!).toBeGreaterThan(row.officialHistoricalLowEur!);

    // Reconcile
    gameRepo.reconcileAllHistoricalLows();

    // Verify corruption is healed
    row = gameRepo.getById(game.id)!;
    expect(row.historicalLowEur).toBe(8.50);
    expect(row.officialHistoricalLowEur).toBe(8.50);
    expect(row.historicalLowEur!).toBeLessThanOrEqual(row.officialHistoricalLowEur!);
  });
});
