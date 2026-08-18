import { describe, it, expect } from 'vitest';
import { 
  computeNextInterval, 
  isAllkeyshopDue, 
  FLOOR_HOURS, 
  CEILING_HOURS, 
  PRICE_TOLERANCE_EUR 
} from '../../src/server/domain/allkeyshopScheduling.js';
import { getRandomAllkeyshopUserAgent, getAllkeyshopHeaders } from '../../src/server/sources/allkeyshop.js';

describe('AllKeyShop Adaptive Scheduling & Pacing Gating', () => {
  describe('1. computeNextInterval (Self-tuning exponential backoff)', () => {
    it('grows interval 24 -> 48 -> 96 when price remains unchanged across 3 checks', () => {
      // Check 1: First check establishing baseline price €15.00 (prevPrice = null)
      const check1 = computeNextInterval(null, 15.00, 0, 24, false);
      expect(check1.intervalHours).toBe(FLOOR_HOURS); // 24
      expect(check1.streak).toBe(0);

      // Check 2: Same price €15.00 observed
      const check2 = computeNextInterval(15.00, 15.00, check1.streak, check1.intervalHours, false);
      expect(check2.intervalHours).toBe(48);
      expect(check2.streak).toBe(1);

      // Check 3: Same price €15.00 observed again
      const check3 = computeNextInterval(15.00, 15.00, check2.streak, check2.intervalHours, false);
      expect(check3.intervalHours).toBe(96);
      expect(check3.streak).toBe(2);

      // Check 4: Same price €15.00 observed again -> reaches ceiling (168h / 7 days)
      const check4 = computeNextInterval(15.00, 15.00, check3.streak, check3.intervalHours, false);
      expect(check4.intervalHours).toBe(CEILING_HOURS); // 168
      expect(check4.streak).toBe(3);

      // Check 5: Stays at ceiling (max 168h / 7 days)
      const check5 = computeNextInterval(15.00, 15.00, check4.streak, check4.intervalHours, false);
      expect(check5.intervalHours).toBe(CEILING_HOURS); // 168
      expect(check5.streak).toBe(4);
    });

    it('tolerates tiny sub-5c fluctuations as unchanged price', () => {
      // €15.00 to €15.03 (within 0.05 EUR tolerance)
      const res = computeNextInterval(15.00, 15.03, 1, 48, false);
      expect(res.intervalHours).toBe(96);
      expect(res.streak).toBe(2);
    });

    it('resets interval to 24h and streak to 0 immediately when price changes after long interval', () => {
      // Price dropped from €15.00 to €9.99 after 192h interval
      const res = computeNextInterval(15.00, 9.99, 5, 192, false);
      expect(res.intervalHours).toBe(FLOOR_HOURS); // 24
      expect(res.streak).toBe(0);
    });

    it('stays at 24h interval when game has an active target price, even with high streak', () => {
      // Game with active target price (hasActiveTargetPrice = true)
      const res = computeNextInterval(15.00, 15.00, 4, 96, true);
      expect(res.intervalHours).toBe(FLOOR_HOURS); // 24
      expect(res.streak).toBe(5); // Streak increments to track stability, but interval is clamped to 24h
    });

    it('handles null new price gracefully by resetting interval to floor', () => {
      const res = computeNextInterval(15.00, null, 2, 48, false);
      expect(res.intervalHours).toBe(FLOOR_HOURS);
      expect(res.streak).toBe(0);
    });
  });

  describe('2. isAllkeyshopDue (Due-filtering evaluation)', () => {
    const now = 1750000000000; // Fixed timestamp

    it('returns true immediately for a brand-new game with null/undefined lastCheckedAt', () => {
      expect(isAllkeyshopDue({}, now)).toBe(true);
      expect(isAllkeyshopDue({ allkeyshopLastCheckedAt: undefined }, now)).toBe(true);
      expect(isAllkeyshopDue({ allkeyshopLastCheckedAt: '' }, now)).toBe(true);
    });

    it('returns false when elapsed time is strictly less than check interval', () => {
      // Checked 12 hours ago with a 24h interval
      const lastChecked = new Date(now - 12 * 3600_000).toISOString();
      expect(isAllkeyshopDue({ allkeyshopLastCheckedAt: lastChecked, allkeyshopCheckIntervalHours: 24 }, now)).toBe(false);

      // Checked 40 hours ago with a 48h interval
      const lastChecked40h = new Date(now - 40 * 3600_000).toISOString();
      expect(isAllkeyshopDue({ allkeyshopLastCheckedAt: lastChecked40h, allkeyshopCheckIntervalHours: 48 }, now)).toBe(false);
    });

    it('returns true when elapsed time meets or exceeds check interval', () => {
      // Checked exactly 24 hours ago with 24h interval
      const lastChecked24h = new Date(now - 24 * 3600_000).toISOString();
      expect(isAllkeyshopDue({ allkeyshopLastCheckedAt: lastChecked24h, allkeyshopCheckIntervalHours: 24 }, now)).toBe(true);

      // Checked 100 hours ago with 96h interval
      const lastChecked100h = new Date(now - 100 * 3600_000).toISOString();
      expect(isAllkeyshopDue({ allkeyshopLastCheckedAt: lastChecked100h, allkeyshopCheckIntervalHours: 96 }, now)).toBe(true);
    });
  });

  describe('3. User-Agent Rotation & Client Hints', () => {
    it('rotates User-Agent strings and generates valid headers', () => {
      const uas = new Set<string>();
      for (let i = 0; i < 30; i++) {
        uas.add(getRandomAllkeyshopUserAgent());
      }
      expect(uas.size).toBeGreaterThan(1);
    });

    it('includes Sec-CH-UA client hints ONLY for Chromium-based User-Agents', () => {
      const chromeUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
      const edgeUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
      const firefoxUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0';
      const safariUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

      const chromeHeaders = getAllkeyshopHeaders(chromeUa);
      expect(chromeHeaders['Sec-CH-UA']).toBeDefined();
      expect(chromeHeaders['Sec-CH-UA-Mobile']).toBe('?0');
      expect(chromeHeaders['Sec-CH-UA-Platform']).toBe('"Windows"');

      const edgeHeaders = getAllkeyshopHeaders(edgeUa);
      expect(edgeHeaders['Sec-CH-UA']).toBeDefined();

      const firefoxHeaders = getAllkeyshopHeaders(firefoxUa);
      expect(firefoxHeaders['Sec-CH-UA']).toBeUndefined();
      expect(firefoxHeaders['Sec-CH-UA-Mobile']).toBeUndefined();
      expect(firefoxHeaders['Sec-CH-UA-Platform']).toBeUndefined();

      const safariHeaders = getAllkeyshopHeaders(safariUa);
      expect(safariHeaders['Sec-CH-UA']).toBeUndefined();
      expect(safariHeaders['Sec-CH-UA-Mobile']).toBeUndefined();
      expect(safariHeaders['Sec-CH-UA-Platform']).toBeUndefined();
    });
  });

  describe('4. Database Persistence & Multi-Pass Integration (Task 1 Data Plumbing)', () => {
    it('getAllWishlistGameIds and getStaleWishlistGameIds return objects carrying all 5 AllKeyShop-scheduling fields', async () => {
      const { profileRepo, gameRepo, getDb } = await import('../../src/server/db/index.js');
      const db = getDb();
      db.exec(`
        PRAGMA foreign_keys = OFF;
        DELETE FROM wishlist_entries;
        DELETE FROM games;
        DELETE FROM profiles;
        PRAGMA foreign_keys = ON;
      `);

      const profile = profileRepo.create('Test User', '76561198000000001');
      const game = gameRepo.upsert({
        steamAppId: 12345,
        title: 'Adaptive Test Game',
        basePriceEur: 29.99
      });

      gameRepo.syncWishlistEntries(profile.id, [{
        steamAppId: 12345,
        title: 'Adaptive Test Game',
        priority: 1
      }]);
      gameRepo.setTargetPrice(profile.id, game.id, 12.50);

      // Verify initial read
      const allWishlist = gameRepo.getAllWishlistGameIds(profile.id);
      expect(allWishlist.length).toBe(1);
      const item = allWishlist[0];

      // Assert all 5 scheduling fields exist on the returned object shape
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('steamAppId');
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('allkeyshopLastCheckedAt');
      expect(item).toHaveProperty('allkeyshopCheckIntervalHours');
      expect(item).toHaveProperty('allkeyshopUnchangedStreak');
      expect(item).toHaveProperty('allkeyshopLastPriceEur');
      expect(item).toHaveProperty('targetPriceEur');
      expect(item.targetPriceEur).toBe(12.50);

      const staleWishlist = gameRepo.getStaleWishlistGameIds(profile.id, 6);
      expect(staleWishlist.length).toBe(1);
      expect(staleWishlist[0]).toHaveProperty('allkeyshopLastCheckedAt');
      expect(staleWishlist[0]).toHaveProperty('allkeyshopCheckIntervalHours');
      expect(staleWishlist[0]).toHaveProperty('allkeyshopUnchangedStreak');
      expect(staleWishlist[0]).toHaveProperty('allkeyshopLastPriceEur');
      expect(staleWishlist[0]).toHaveProperty('targetPriceEur');
    });

    it('grows interval (24 -> 48) across consecutive simulated enrichment passes with unchanged price', async () => {
      const { profileRepo, gameRepo, getDb } = await import('../../src/server/db/index.js');
      const db = getDb();
      db.exec(`
        PRAGMA foreign_keys = OFF;
        DELETE FROM wishlist_entries;
        DELETE FROM games;
        DELETE FROM profiles;
        PRAGMA foreign_keys = ON;
      `);

      const profile = profileRepo.create('Pass User', '76561198000000002');
      const game = gameRepo.upsert({
        steamAppId: 99999,
        title: 'Backoff Test Game',
        basePriceEur: 49.99
      });

      gameRepo.syncWishlistEntries(profile.id, [{
        steamAppId: 99999,
        title: 'Backoff Test Game',
        priority: 1
      }]);

      // --- SIMULATED ENRICHMENT PASS 1 ---
      const pass1Games = gameRepo.getAllWishlistGameIds(profile.id);
      expect(pass1Games.length).toBe(1);
      const g1 = pass1Games[0];
      expect(isAllkeyshopDue(g1)).toBe(true);

      const observedPrice1 = 19.99;
      const sched1 = computeNextInterval(
        g1.allkeyshopLastPriceEur ?? null,
        observedPrice1,
        g1.allkeyshopUnchangedStreak ?? 0,
        g1.allkeyshopCheckIntervalHours ?? 24,
        Boolean(g1.targetPriceEur)
      );
      expect(sched1.intervalHours).toBe(24);
      expect(sched1.streak).toBe(0);

      // Persist Pass 1 state
      const pass1Time = new Date().toISOString();
      gameRepo.updateAllkeyshopCheckState(g1.id, pass1Time, observedPrice1, sched1.intervalHours, sched1.streak);

      // --- SIMULATED ENRICHMENT PASS 2 ---
      // Read back persisted state directly via getAllWishlistGameIds
      const pass2Games = gameRepo.getAllWishlistGameIds(profile.id);
      const g2 = pass2Games[0];

      expect(g2.allkeyshopLastCheckedAt).toBe(pass1Time);
      expect(g2.allkeyshopLastPriceEur).toBe(19.99);
      expect(g2.allkeyshopCheckIntervalHours).toBe(24);
      expect(g2.allkeyshopUnchangedStreak).toBe(0);

      // Same price observed again
      const observedPrice2 = 19.99;
      const sched2 = computeNextInterval(
        g2.allkeyshopLastPriceEur ?? null,
        observedPrice2,
        g2.allkeyshopUnchangedStreak ?? 0,
        g2.allkeyshopCheckIntervalHours ?? 24,
        Boolean(g2.targetPriceEur)
      );

      // Crucial assertion: interval grows from 24h to 48h!
      expect(sched2.intervalHours).toBe(48);
      expect(sched2.streak).toBe(1);

      // Persist Pass 2 state
      const pass2Time = new Date().toISOString();
      gameRepo.updateAllkeyshopCheckState(g2.id, pass2Time, observedPrice2, sched2.intervalHours, sched2.streak);

      // --- SIMULATED ENRICHMENT PASS 3 ---
      const pass3Games = gameRepo.getAllWishlistGameIds(profile.id);
      const g3 = pass3Games[0];
      expect(g3.allkeyshopCheckIntervalHours).toBe(48);
      expect(g3.allkeyshopUnchangedStreak).toBe(1);

      const sched3 = computeNextInterval(
        g3.allkeyshopLastPriceEur ?? null,
        19.99,
        g3.allkeyshopUnchangedStreak ?? 0,
        g3.allkeyshopCheckIntervalHours ?? 24,
        Boolean(g3.targetPriceEur)
      );
      // Crucial assertion: interval grows from 48h to 96h!
      expect(sched3.intervalHours).toBe(96);
      expect(sched3.streak).toBe(2);
    });
  });
});
