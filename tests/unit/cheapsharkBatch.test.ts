import { describe, it, expect, beforeEach } from 'vitest';
import { cheapsharkAdapter } from '../../src/server/sources/cheapshark.js';
import { getDb } from '../../src/server/db/index.js';

function resetDatabase() {
  const db = getDb();
  db.exec(`
    PRAGMA foreign_keys = OFF;
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

describe('CheapShark Batch Source Adapter', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('supportsBatch should be true and code should be cheapshark', () => {
    expect(cheapsharkAdapter.supportsBatch).toBe(true);
    expect(cheapsharkAdapter.code).toBe('cheapshark');
    expect(cheapsharkAdapter.isEnabled()).toBe(true);
  });

  it('fetchBatchPrices handles empty game list gracefully', async () => {
    const results = await cheapsharkAdapter.fetchBatchPrices([]);
    expect(results.size).toBe(0);
  });

  it('fetchBatchPrices returns valid Map for game queries with onProgress reporting', async () => {
    let progressCalls = 0;
    const progressSpy = (processed: number, total: number, _action?: string) => {
      progressCalls++;
      expect(total).toBe(2);
      expect(processed).toBeGreaterThanOrEqual(0);
    };

    const games = [
      { steamAppId: 1091500, title: 'Cyberpunk 2077' },
      { steamAppId: 292030, title: 'The Witcher 3: Wild Hunt' }
    ];

    const results = await cheapsharkAdapter.fetchBatchPrices(games, progressSpy);
    expect(results).toBeInstanceOf(Map);
    expect(progressCalls).toBeGreaterThan(0);
  });
});
