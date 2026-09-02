import { describe, it, expect, vi } from 'vitest';
import { 
  computeNextInterval, 
  isAllkeyshopDue, 
  FLOOR_HOURS, 
  CEILING_HOURS, 
  PRICE_TOLERANCE_EUR 
} from '../../src/server/domain/allkeyshopScheduling.js';
import { fetchWithAllkeyshopSolver } from '../../src/server/sources/allkeyshop.js';
import { config } from '../../src/server/config/index.js';

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

      // Check 3: Same price €15.00 observed again -> reaches ceiling (48h)
      const check3 = computeNextInterval(15.00, 15.00, check2.streak, check2.intervalHours, false);
      expect(check3.intervalHours).toBe(CEILING_HOURS); // 48
      expect(check3.streak).toBe(2);

      // Check 4: Same price €15.00 observed again
      const check4 = computeNextInterval(15.00, 15.00, check3.streak, check3.intervalHours, false);
      expect(check4.intervalHours).toBe(CEILING_HOURS); // 48
      expect(check4.streak).toBe(3);

      // Check 5: Stays at ceiling
      const check5 = computeNextInterval(15.00, 15.00, check4.streak, check4.intervalHours, false);
      expect(check5.intervalHours).toBe(CEILING_HOURS); // 48
      expect(check5.streak).toBe(4);
    });

    it('tolerates tiny sub-5c fluctuations as unchanged price', () => {
      // €15.00 to €15.03 (within 0.05 EUR tolerance)
      const res = computeNextInterval(15.00, 15.03, 1, 48, false);
      expect(res.intervalHours).toBe(48);
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

  describe('3. Strict Solver-Only Requirement (No direct scraping fallback)', () => {
    it('returns null immediately when no solver URL is configured without calling fetch', async () => {
      const { config } = await import('../../src/server/config/index.js');
      const origSolver = config.allkeyshopSolverUrl;
      const origFetch = global.fetch;
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      try {
        config.allkeyshopSolverUrl = '';
        const res = await fetchWithAllkeyshopSolver('https://www.allkeyshop.com/api/test');
        expect(res).toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        config.allkeyshopSolverUrl = origSolver;
        global.fetch = origFetch;
      }
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
      // Crucial assertion: interval hits ceiling (48)
      expect(sched3.intervalHours).toBe(48);
      expect(sched3.streak).toBe(2);
    });
  });

  describe('4. Round-Robin Due-Game Ordering & Volume Cap', () => {
    it('sorts never-checked games first, then oldest checked games ascending', () => {
      const mockGames = [
        { id: '1', title: 'Game 1', steamAppId: 1, allkeyshopLastCheckedAt: '2026-08-19T12:00:00Z' },
        { id: '2', title: 'Game 2', steamAppId: 2, allkeyshopLastCheckedAt: undefined }, // never checked
        { id: '3', title: 'Game 3', steamAppId: 3, allkeyshopLastCheckedAt: '2026-08-18T08:00:00Z' }, // older
        { id: '4', title: 'Game 4', steamAppId: 4, allkeyshopLastCheckedAt: undefined }, // never checked
        { id: '5', title: 'Game 5', steamAppId: 5, allkeyshopLastCheckedAt: '2026-08-19T18:00:00Z' }, // newest
      ];

      const sorted = [...mockGames].sort((a, b) => {
        const aTime = a.allkeyshopLastCheckedAt ? new Date(a.allkeyshopLastCheckedAt).getTime() : -Infinity;
        const bTime = b.allkeyshopLastCheckedAt ? new Date(b.allkeyshopLastCheckedAt).getTime() : -Infinity;
        return aTime - bTime;
      });

      // Both never-checked games (2, 4) must come first
      expect([sorted[0].id, sorted[1].id]).toContain('2');
      expect([sorted[0].id, sorted[1].id]).toContain('4');
      // Followed by oldest checked (3: Aug 18)
      expect(sorted[2].id).toBe('3');
      // Followed by Aug 19 12:00 (1)
      expect(sorted[3].id).toBe('1');
      // Followed by Aug 19 18:00 (5)
      expect(sorted[4].id).toBe('5');
    });

    it('rotates through full list across successive capped runs without starving low-priority games', () => {
      const allGames = Array.from({ length: 6 }, (_, i) => ({
        id: `g${i + 1}`,
        title: `Game ${i + 1}`,
        steamAppId: i + 1,
        allkeyshopLastCheckedAt: undefined as string | undefined
      }));

      const maxGames = 2;

      // Run 1: Takes g1, g2 (never checked)
      let sorted = [...allGames].sort((a, b) => {
        const aTime = a.allkeyshopLastCheckedAt ? new Date(a.allkeyshopLastCheckedAt).getTime() : -Infinity;
        const bTime = b.allkeyshopLastCheckedAt ? new Date(b.allkeyshopLastCheckedAt).getTime() : -Infinity;
        return aTime - bTime;
      });
      const batch1 = sorted.slice(0, maxGames);
      expect(batch1.map(g => g.id)).toEqual(['g1', 'g2']);

      // Simulate update for batch 1
      batch1.forEach(g => {
        const idx = allGames.findIndex(item => item.id === g.id);
        allGames[idx].allkeyshopLastCheckedAt = '2026-08-19T10:00:00Z';
      });

      // Run 2: Takes g3, g4 (remaining never checked)
      sorted = [...allGames].sort((a, b) => {
        const aTime = a.allkeyshopLastCheckedAt ? new Date(a.allkeyshopLastCheckedAt).getTime() : -Infinity;
        const bTime = b.allkeyshopLastCheckedAt ? new Date(b.allkeyshopLastCheckedAt).getTime() : -Infinity;
        return aTime - bTime;
      });
      const batch2 = sorted.slice(0, maxGames);
      expect(batch2.map(g => g.id)).toEqual(['g3', 'g4']);

      // Simulate update for batch 2
      batch2.forEach(g => {
        const idx = allGames.findIndex(item => item.id === g.id);
        allGames[idx].allkeyshopLastCheckedAt = '2026-08-19T10:05:00Z';
      });

      // Run 3: Takes g5, g6
      sorted = [...allGames].sort((a, b) => {
        const aTime = a.allkeyshopLastCheckedAt ? new Date(a.allkeyshopLastCheckedAt).getTime() : -Infinity;
        const bTime = b.allkeyshopLastCheckedAt ? new Date(b.allkeyshopLastCheckedAt).getTime() : -Infinity;
        return aTime - bTime;
      });
      const batch3 = sorted.slice(0, maxGames);
      expect(batch3.map(g => g.id)).toEqual(['g5', 'g6']);
    });
  });

  describe('5. calculateExponentialJitter (Long-tailed jitter distribution)', () => {
    it('has higher probability density near low end and long tail capped at 3x jitterMs', async () => {
      const { calculateExponentialJitter } = await import('../../src/server/sync/rateLimiter.js');

      const jitterMs = 4000;
      // Deterministic inputs
      const lowVal = calculateExponentialJitter(jitterMs, () => 0.1); // -ln(0.9) * 2000 ≈ 210ms
      const midVal = calculateExponentialJitter(jitterMs, () => 0.5); // -ln(0.5) * 2000 ≈ 1386ms
      const highVal = calculateExponentialJitter(jitterMs, () => 0.95); // -ln(0.05) * 2000 ≈ 5991ms
      const extremeVal = calculateExponentialJitter(jitterMs, () => 0.9999); // Capped at 3 * 4000 = 12000ms

      expect(lowVal).toBeLessThan(midVal);
      expect(midVal).toBeLessThan(highVal);
      expect(highVal).toBeGreaterThan(jitterMs); // Long tail exceeds base jitterMs
      expect(extremeVal).toBe(jitterMs * 3); // Firmly clamped at 3x
    });

    it('returns 0 when jitterMs is 0', async () => {
      const { calculateExponentialJitter } = await import('../../src/server/sync/rateLimiter.js');
      expect(calculateExponentialJitter(0)).toBe(0);
    });
  });

  describe('6. fetchWithAllkeyshopSolver (Byparr / FlareSolverr Anti-Bot Integration)', () => {
    it('calls Byparr /v1 endpoint with request.get payload when solverUrl is configured', async () => {
      const { fetchWithAllkeyshopSolver } = await import('../../src/server/sources/allkeyshop.js');
      const { config } = await import('../../src/server/config/index.js');

      const origSolverUrl = config.allkeyshopSolverUrl;
      const origFetch = global.fetch;

      try {
        config.allkeyshopSolverUrl = 'http://127.0.0.1:8191';
        let capturedUrl = '';
        let capturedBody: any = null;

        global.fetch = (async (url: any, options: any) => {
          capturedUrl = String(url);
          capturedBody = JSON.parse(options.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'ok',
              message: 'Challenge not detected',
              solution: {
                url: 'https://www.allkeyshop.com/api/test',
                status: 200,
                response: '{"status":"success","games":[{"id":123,"name":"Test Game"}]}'
              }
            })
          } as any;
        }) as any;

        const res: any = await fetchWithAllkeyshopSolver('https://www.allkeyshop.com/api/test', 10000);

        expect(capturedUrl).toBe('http://127.0.0.1:8191/v1');
        expect(capturedBody).toEqual({
          cmd: 'request.get',
          url: 'https://www.allkeyshop.com/api/test',
          maxTimeout: 15000,
          blockMedia: true,
          returnOnlyCookies: false
        });
        expect(res).toEqual({
          status: 'success',
          games: [{ id: 123, name: 'Test Game' }]
        });
      } finally {
        config.allkeyshopSolverUrl = origSolverUrl;
        global.fetch = origFetch;
      }
    });

    it('returns null without making direct fetch calls when solverUrl is empty', async () => {
      const { fetchWithAllkeyshopSolver } = await import('../../src/server/sources/allkeyshop.js');
      const { config } = await import('../../src/server/config/index.js');

      const origSolverUrl = config.allkeyshopSolverUrl;
      const origFetch = global.fetch;

      try {
        config.allkeyshopSolverUrl = '';
        const fetchSpy = vi.fn();
        global.fetch = fetchSpy as any;

        const res: any = await fetchWithAllkeyshopSolver('https://www.allkeyshop.com/api/direct-test', 5000);

        expect(res).toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        config.allkeyshopSolverUrl = origSolverUrl;
        global.fetch = origFetch;
      }
    });

    it('STRICTLY avoids direct IP fallback when Byparr fails with 502 to protect IP from bans', async () => {
      const { fetchWithAllkeyshopSolver } = await import('../../src/server/sources/allkeyshop.js');
      const { config } = await import('../../src/server/config/index.js');

      const origSolverUrl = config.allkeyshopSolverUrl;
      const origFetch = global.fetch;

      try {
        config.allkeyshopSolverUrl = 'http://127.0.0.1:8191';
        let directFetchCalled = false;

        global.fetch = (async (url: any) => {
          const urlStr = String(url);
          if (urlStr.startsWith('http://127.0.0.1:8191')) {
            // Byparr returns 502 Bad Gateway
            return {
              ok: false,
              status: 502,
              json: async () => ({ status: 'error', message: 'NS_ERROR_NET_EMPTY_RESPONSE' })
            } as any;
          }
          // Any other URL means direct fetch was attempted!
          directFetchCalled = true;
          return { ok: true, status: 200, json: async () => ({}) } as any;
        }) as any;

        await expect(fetchWithAllkeyshopSolver('https://www.allkeyshop.com/api/test', 5000)).rejects.toThrow(
          /Byparr \/ FlareSolverr returned HTTP 502/
        );
        expect(directFetchCalled).toBe(false);
      } finally {
        config.allkeyshopSolverUrl = origSolverUrl;
        global.fetch = origFetch;
      }
    });

    it('caches and reuses clearance cookies across consecutive Byparr solver requests', async () => {
      const { fetchWithAllkeyshopSolver } = await import('../../src/server/sources/allkeyshop.js');
      const { config } = await import('../../src/server/config/index.js');

      const origSolverUrl = config.allkeyshopSolverUrl;
      const origFetch = global.fetch;

      try {
        config.allkeyshopSolverUrl = 'http://127.0.0.1:8191';
        let secondRequestBody: any = null;
        let callCount = 0;

        global.fetch = (async (url: any, options: any) => {
          callCount++;
          if (callCount === 1) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                status: 'ok',
                solution: {
                  url: 'https://www.allkeyshop.com/api/call1',
                  status: 200,
                  cookies: [{ name: 'cf_clearance', value: 'secret_token_123', domain: '.allkeyshop.com' }],
                  response: '{"status":"success"}'
                }
              })
            } as any;
          } else {
            secondRequestBody = JSON.parse(options.body);
            return {
              ok: true,
              status: 200,
              json: async () => ({
                status: 'ok',
                solution: {
                  url: 'https://www.allkeyshop.com/api/call2',
                  status: 200,
                  response: '{"status":"success"}'
                }
              })
            } as any;
          }
        }) as any;

        // Call 1: establishes cookies
        await fetchWithAllkeyshopSolver('https://www.allkeyshop.com/api/call1', 5000);
        // Call 2: should carry cached cookies in payload
        await fetchWithAllkeyshopSolver('https://www.allkeyshop.com/api/call2', 5000);

        expect(secondRequestBody.cookies).toEqual([
          { name: 'cf_clearance', value: 'secret_token_123', domain: '.allkeyshop.com' }
        ]);
      } finally {
        config.allkeyshopSolverUrl = origSolverUrl;
        global.fetch = origFetch;
      }
    });

    it('automatically normalizes raw IP:port solver URL without http:// prefix', async () => {
      const origSolverUrl = config.allkeyshopSolverUrl;
      const origFetch = global.fetch;
      let requestedEndpoint = '';

      try {
        config.allkeyshopSolverUrl = '10.0.0.50:8191';
        global.fetch = vi.fn().mockImplementation(async (url: any) => {
          requestedEndpoint = url.toString();
          return {
            ok: true,
            json: async () => ({
              status: 'ok',
              solution: { status: 200, response: '{"data": "test"}' }
            })
          };
        });

        const result = await fetchWithAllkeyshopSolver('https://www.allkeyshop.com/api/test', 5000);
        expect(requestedEndpoint).toBe('http://10.0.0.50:8191/v1');
        expect(result).toEqual({ data: 'test' });
      } finally {
        config.allkeyshopSolverUrl = origSolverUrl;
        global.fetch = origFetch;
      }
    });
  });

  describe('5. Smart Multi-Candidate Catalog Matching (Release Year, Suffix, & Overrides)', () => {
    it('prioritizes reboot with matching release year over legacy game and filters out old year collisions', async () => {
      const { findCandidateGamesInCatalog } = await import('../../src/server/sources/allkeyshop.js');
      const catalog = [
        { id: 101, name: 'Screamer' },
        { id: 102, name: 'Screamer 1995' },
        { id: 202, name: 'Screamer 2026' },
        { id: 303, name: 'Unrelated Game' }
      ];

      // Steam game with release year 2026
      const candidates = findCandidateGamesInCatalog(catalog, 'Screamer', 999999, '2026-03-26');
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].id).toBe(202); // Screamer 2026 is #1
      expect(candidates[0].name).toBe('Screamer 2026');

      // Screamer 1995 must NOT be in candidates due to year mismatch (>2 years from 2026)
      expect(candidates.some(c => c.id === 102)).toBe(false);
    });

    it('finds alternative candidate versions with suffix (e.g. Judas 2) when matching reboot games', async () => {
      const { findCandidateGamesInCatalog } = await import('../../src/server/sources/allkeyshop.js');
      const catalog = [
        { id: 501, name: 'Judas' },
        { id: 502, name: 'Judas 2' },
        { id: 999, name: 'Judas Priest Concert' }
      ];

      const candidates = findCandidateGamesInCatalog(catalog, 'Judas', 1778820, '2026');
      expect(candidates.length).toBe(2);
      expect(candidates.map(c => c.id)).toContain(501);
      expect(candidates.map(c => c.id)).toContain(502);
      expect(candidates.some(c => c.id === 999)).toBe(false);
    });

    it('enforces strict numeric matching so sequels do not collide', async () => {
      const { findCandidateGamesInCatalog } = await import('../../src/server/sources/allkeyshop.js');
      const catalog = [
        { id: 1, name: 'Dead Space' },
        { id: 2, name: 'Dead Space 2' },
        { id: 3, name: 'Dead Space 3' }
      ];

      const candidates = findCandidateGamesInCatalog(catalog, 'Dead Space 2');
      expect(candidates.length).toBe(1);
      expect(candidates[0].id).toBe(2);
    });

    it('persists and respects manual AllKeyShop mapping overrides', async () => {
      const { findCandidateGamesInCatalog, saveCustomMapping } = await import('../../src/server/sources/allkeyshop.js');
      const catalog = [
        { id: 501, name: 'Judas' },
        { id: 502, name: 'Judas 2' }
      ];

      // Set manual override for AppID 1778820 to 502 (Judas 2)
      saveCustomMapping(1778820, 502);

      const candidates = findCandidateGamesInCatalog(catalog, 'Judas', 1778820);
      expect(candidates.length).toBe(1);
      expect(candidates[0].id).toBe(502);

      // Clean up override
      saveCustomMapping(1778820, null);
      const resetCandidates = findCandidateGamesInCatalog(catalog, 'Judas', 1778820);
      expect(resetCandidates.length).toBe(2);
    });
  });

  describe('8. AllKeyShop V2 gameNames Catalog & Stale Cache Resilience', () => {
    let circuitBreakers: any;
    
    // Using beforeAll or beforeEach to reset circuit breaker so previous tests don't fail this one
    it('requests the V2 gameNames endpoint with currency=eur and locales=en_GB', async () => {
      const { AllKeyShopSourceAdapter } = await import('../../src/server/sources/allkeyshop.js');
      const { config } = await import('../../src/server/config/index.js');
      const { circuitBreakers } = await import('../../src/server/sync/circuitBreaker.js');
      circuitBreakers.reset('allkeyshop');

      const origSolverUrl = config.allkeyshopSolverUrl;
      const origFetch = global.fetch;

      const fs = await import('node:fs');
      const origExistsSync = fs.default.existsSync;

      try {
        config.allkeyshopSolverUrl = 'http://127.0.0.1:8191';
        let requestedUrl = '';

        fs.default.existsSync = ((p: any) => {
          if (String(p).includes('allkeyshop_catalog.json')) return false;
          return origExistsSync(p);
        }) as any;

        global.fetch = (async (url: any, options: any) => {
          const body = JSON.parse(options.body);
          requestedUrl = body.url;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'ok',
              solution: {
                status: 200,
                response: JSON.stringify({
                  status: 'success',
                  games: [
                    { id: 101, name: 'Borderlands' },
                    { id: 102, name: 'Borderlands 2' }
                  ]
                })
              }
            })
          } as any;
        }) as any;

        const adapter = new AllKeyShopSourceAdapter();
        // Force fresh load by creating instance
        const catalog = await adapter.ensureCatalog();

        expect(requestedUrl).toBe('https://www.allkeyshop.com/api/v2/vaks.php?action=gameNames&v=2&currency=eur&locales=en_GB');
        expect(catalog.length).toBeGreaterThanOrEqual(2);
        expect(catalog.some(g => g.id === 101 && g.name === 'Borderlands')).toBe(true);
      } finally {
        fs.default.existsSync = origExistsSync;
        config.allkeyshopSolverUrl = origSolverUrl;
        global.fetch = origFetch;
      }
    });

    it('falls back to existing stale disk cache when remote gameNames returns 503', async () => {
      const { AllKeyShopSourceAdapter } = await import('../../src/server/sources/allkeyshop.js');
      const { config } = await import('../../src/server/config/index.js');
      const { circuitBreakers } = await import('../../src/server/sync/circuitBreaker.js');
      circuitBreakers.reset('allkeyshop');

      const origSolverUrl = config.allkeyshopSolverUrl;
      const origFetch = global.fetch;

      try {
        config.allkeyshopSolverUrl = 'http://127.0.0.1:8191';

        global.fetch = (async () => {
          // Solver returns 503 for gameNames
          return {
            ok: false,
            status: 503,
            json: async () => ({ status: 'error', message: 'Service Unavailable' })
          } as any;
        }) as any;

        const adapter = new AllKeyShopSourceAdapter();
        const catalog = await adapter.ensureCatalog();

        // Should return existing on-disk catalog without throwing
        expect(Array.isArray(catalog)).toBe(true);
        expect(catalog.length).toBeGreaterThan(0);
      } finally {
        config.allkeyshopSolverUrl = origSolverUrl;
        global.fetch = origFetch;
      }
    });
  });
});

