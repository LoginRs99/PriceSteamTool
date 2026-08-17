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

      // Check 4: Same price €15.00 observed again
      const check4 = computeNextInterval(15.00, 15.00, check3.streak, check3.intervalHours, false);
      expect(check4.intervalHours).toBe(192);
      expect(check4.streak).toBe(3);

      // Check 5: Reaching ceiling (max 336h / 14 days)
      const check5 = computeNextInterval(15.00, 15.00, check4.streak, check4.intervalHours, false);
      expect(check5.intervalHours).toBe(CEILING_HOURS); // 336
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

  describe('3. User-Agent Rotation', () => {
    it('rotates User-Agent strings and generates valid headers', () => {
      const uas = new Set<string>();
      for (let i = 0; i < 30; i++) {
        uas.add(getRandomAllkeyshopUserAgent());
      }
      expect(uas.size).toBeGreaterThan(1);

      const headers = getAllkeyshopHeaders();
      expect(headers['User-Agent']).toBeDefined();
      expect(headers['Accept']).toContain('application/json');
      expect(headers['Sec-Fetch-Site']).toBe('same-origin');
    });
  });
});
