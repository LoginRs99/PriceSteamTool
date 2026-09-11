import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { offerRepo } from '../../src/server/db/repositories/offer.js';
import { gameRepo } from '../../src/server/db/repositories/game.js';
import { merchantRepo } from '../../src/server/db/repositories/merchant.js';
import { getDb } from '../../src/server/db/core.js';
import * as coreDb from '../../src/server/db/core.js';
import { logInfo } from '../../src/server/utils/logger.js';
import { config } from '../../src/server/config/index.js';

describe('Task 20: N+1 Source Queries & Unbounded Diagnostics Log Rotation', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec(`
      DELETE FROM source_observations;
      DELETE FROM price_history;
      DELETE FROM anomalies;
      DELETE FROM offers;
      DELETE FROM wishlist_entries;
      DELETE FROM games;
      DELETE FROM merchants;
    `);
    vi.restoreAllMocks();
  });

  describe('getOffersForGame N+1 query elimination', () => {
    it('returns empty array when game has no offers (guards empty IDs without throwing)', () => {
      const offers = offerRepo.getOffersForGame('non-existent-game-id');
      expect(offers).toEqual([]);
    });

    it('batches source_observations query into a single SELECT ... WHERE offer_id IN (...)', () => {
      const game = gameRepo.upsert({ steamAppId: 99901, title: 'Batched Offer Game' });
      const m1 = merchantRepo.getOrCreate('steam_store', 'Steam Store', true);
      const m2 = merchantRepo.getOrCreate('fanatical', 'Fanatical', true);
      const m3 = merchantRepo.getOrCreate('g2a', 'G2A', false);

      // Create 3 offers for this game
      const offer1 = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: m1.id,
        productType: 'GAME',
        regionType: 'GLOBAL',
        priceEur: 10,
        dealUrl: 'https://store.steampowered.com/app/99901',
        sourceCode: 'steam'
      });

      const offer2 = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: m2.id,
        productType: 'GAME',
        regionType: 'GLOBAL',
        priceEur: 15,
        dealUrl: 'https://store.steampowered.com/app/99901-2',
        sourceCode: 'itad'
      });

      const offer3 = offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: m3.id,
        productType: 'GAME',
        regionType: 'GLOBAL',
        priceEur: 20,
        dealUrl: 'https://store.steampowered.com/app/99901-3',
        sourceCode: 'ggdeals'
      });

      // Spy on prepareStmt to count queries targeting source_observations
      const prepareStmtSpy = vi.spyOn(coreDb, 'prepareStmt');

      const offers = offerRepo.getOffersForGame(game.id);

      expect(offers).toHaveLength(3);

      // Find all queries to source_observations
      const sourceObservationQueries = prepareStmtSpy.mock.calls.filter(call => 
        typeof call[0] === 'string' && call[0].includes('source_observations')
      );

      // Exactly ONE batched query should have been prepared, NOT 3 individual queries
      expect(sourceObservationQueries).toHaveLength(1);
      expect(sourceObservationQueries[0][0]).toContain('WHERE offer_id IN (?,?,?)');

      // Verify each offer received its mapped sources correctly
      const o1 = offers.find(o => o.id === offer1.id);
      const o2 = offers.find(o => o.id === offer2.id);
      const o3 = offers.find(o => o.id === offer3.id);

      expect(o1?.sources).toEqual(['steam']);
      expect(o1?.sourceAgreementCount).toBe(1);

      expect(o2?.sources).toEqual(['itad']);
      expect(o2?.sourceAgreementCount).toBe(1);

      expect(o3?.sources).toEqual(['ggdeals']);
      expect(o3?.sourceAgreementCount).toBe(1);
    });
  });

  describe('appendToFile 10 MB log rotation', () => {
    const logFilePath = path.join(config.dataDir, 'sync_diagnostics.log');
    const rotatedPath = `${logFilePath}.1`;

    it('rotates log file when size reaches 10 MB and overwrites existing .1', () => {
      const existsSyncSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => {
        return p === logFilePath;
      });

      const statSyncSpy = vi.spyOn(fs, 'statSync').mockImplementation((p: any) => {
        if (p === logFilePath) {
          return { size: 10 * 1024 * 1024 + 50 } as any; // > 10 MB
        }
        return {} as any;
      });

      const renameSyncSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {});
      const appendFileSyncSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

      logInfo('Test rotating message');

      expect(existsSyncSpy).toHaveBeenCalledWith(logFilePath);
      expect(statSyncSpy).toHaveBeenCalledWith(logFilePath);
      expect(renameSyncSpy).toHaveBeenCalledWith(logFilePath, rotatedPath);
      expect(appendFileSyncSpy).toHaveBeenCalledWith(logFilePath, expect.stringContaining('Test rotating message'), 'utf-8');
    });

    it('does not rotate when log file is smaller than 10 MB', () => {
      vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => p === logFilePath);
      vi.spyOn(fs, 'statSync').mockImplementation((p: any) => ({ size: 5 * 1024 * 1024 } as any));
      const renameSyncSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {});
      vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {});

      logInfo('Test normal message');

      expect(renameSyncSpy).not.toHaveBeenCalled();
    });

    it('silently catches errors during statSync/renameSync/appendFileSync', () => {
      vi.spyOn(fs, 'existsSync').mockImplementation(() => {
        throw new Error('Disk IO error');
      });

      // Must not throw
      expect(() => {
        logInfo('Test error suppression');
      }).not.toThrow();
    });
  });
});
