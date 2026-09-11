import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { checkRateLimit, peekRateLimit, resetRateLimits } from '../../src/server/routes/rateLimit.js';
import { v1Routes } from '../../src/server/routes/v1.js';

describe('Inbound Rate Limiting Engine (Fixed-Window 60s)', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it('allows requests within limit and decrements remaining', () => {
    const key = 'test-ip-1';
    const limit = 5;

    const r1 = checkRateLimit(key, 1000, limit);
    expect(r1.allowed).toBe(true);
    expect(r1.limit).toBe(5);
    expect(r1.remaining).toBe(4);
    expect(r1.resetSeconds).toBe(60);

    const r2 = checkRateLimit(key, 2000, limit);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(3);
    expect(r2.resetSeconds).toBe(59);

    const r3 = checkRateLimit(key, 3000, limit);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(2);

    const r4 = checkRateLimit(key, 4000, limit);
    expect(r4.allowed).toBe(true);
    expect(r4.remaining).toBe(1);

    const r5 = checkRateLimit(key, 5000, limit);
    expect(r5.allowed).toBe(true);
    expect(r5.remaining).toBe(0);

    // Exceeded
    const r6 = checkRateLimit(key, 6000, limit);
    expect(r6.allowed).toBe(false);
    expect(r6.remaining).toBe(0);
    expect(r6.resetSeconds).toBe(55);
  });

  it('resets window after 60 seconds have elapsed', () => {
    const key = 'test-ip-reset';
    const limit = 2;

    checkRateLimit(key, 1000, limit);
    checkRateLimit(key, 2000, limit);
    const denied = checkRateLimit(key, 3000, limit);
    expect(denied.allowed).toBe(false);

    // 61 seconds later
    const newWindow = checkRateLimit(key, 62000, limit);
    expect(newWindow.allowed).toBe(true);
    expect(newWindow.remaining).toBe(1);
    expect(newWindow.resetSeconds).toBe(60);
  });

  it('peekRateLimit reads remaining without incrementing count', () => {
    const key = 'test-ip-peek';
    const limit = 10;

    checkRateLimit(key, 1000, limit);
    const peek1 = peekRateLimit(key, 1500, limit);
    expect(peek1.remaining).toBe(9);

    const peek2 = peekRateLimit(key, 2000, limit);
    expect(peek2.remaining).toBe(9); // Unchanged!
  });

  it('opportunistically evicts stale windows when store exceeds 100 keys', () => {
    const baseTime = 10000;
    // Insert 105 stale entries
    for (let i = 0; i < 105; i++) {
      checkRateLimit(`stale-ip-${i}`, baseTime, 10);
    }

    // 70 seconds later, insert a new key to trigger opportunistic eviction
    const rNew = checkRateLimit('fresh-ip', baseTime + 70000, 10);
    expect(rNew.allowed).toBe(true);

    // Stale key should start fresh on next request
    const rStaleRevisited = checkRateLimit('stale-ip-0', baseTime + 70000, 10);
    expect(rStaleRevisited.remaining).toBe(9);
  });
});

describe('Live Rate Limit Headers & 429 Rejection in Fastify v1Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetRateLimits();
  });

  it('emits live decreasing remaining headers and returns 429 with retryAfterSeconds on denial', async () => {
    app = Fastify();
    await app.register(v1Routes);
    await app.ready();

    // Make 3 requests from IP 192.168.1.50
    const ip = '192.168.1.50';
    const res1 = await app.inject({ method: 'GET', url: '/api/v1/quota', remoteAddress: ip });
    expect(res1.statusCode).toBe(200);
    const body1 = JSON.parse(res1.body);
    const initialRemaining = body1.currentWindowRemaining;
    expect(res1.headers['x-ratelimit-remaining']).toBe(String(initialRemaining));
    expect(res1.headers['ratelimit-remaining']).toBe(String(initialRemaining));

    const res2 = await app.inject({ method: 'GET', url: '/api/v1/quota', remoteAddress: ip });
    expect(res2.statusCode).toBe(200);
    const body2 = JSON.parse(res2.body);
    expect(body2.currentWindowRemaining).toBe(initialRemaining - 1);
    expect(res2.headers['x-ratelimit-remaining']).toBe(String(initialRemaining - 1));

    // Exhaust remaining by calling checkRateLimit until 0
    while (checkRateLimit(ip).allowed) {
      // drain
    }

    // Next request from same IP must be 429
    const resBlocked = await app.inject({ method: 'GET', url: '/api/v1/quota', remoteAddress: ip });
    expect(resBlocked.statusCode).toBe(429);
    expect(resBlocked.headers['x-ratelimit-remaining']).toBe('0');
    expect(resBlocked.headers['ratelimit-remaining']).toBe('0');
    expect(resBlocked.headers['retry-after']).toBeDefined();

    const blockedJson = JSON.parse(resBlocked.body);
    expect(blockedJson.error).toBe('Rate limit exceeded');
    expect(blockedJson.retryAfterSeconds).toBeGreaterThanOrEqual(1);

    await app.close();
  });
});
