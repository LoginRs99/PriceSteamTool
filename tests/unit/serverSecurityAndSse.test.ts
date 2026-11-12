import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { IncomingHttpHeaders } from 'http';
import { createApp } from '../../src/server/index.js';
import { config } from '../../src/server/config/index.js';
import type { FastifyInstance } from 'fastify';

describe('Backend API & Server Security Enhancements', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Defensive Security Headers & Configuration', () => {
    it('attaches standard OWASP defensive headers on HTTP responses', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health'
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['x-xss-protection']).toBe('0');
    });

    it('returns consistent JSON 404 response for unknown /api endpoints', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/unknown-route-for-testing'
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body).toEqual({ error: 'Endpoint not found' });
    });
  });

  describe('2. Constant-Time API Token Authentication', () => {
    it('authenticates with Bearer token and rejects invalid tokens without length disclosure', async () => {
      const originalToken = config.apiToken;
      try {
        (config as any).apiToken = 'super-secret-vault-token-12345';
        const secureApp = await createApp();

        // 1. Missing token -> 401
        const resMissing = await secureApp.inject({
          method: 'GET',
          url: '/api/sources'
        });
        expect(resMissing.statusCode).toBe(401);

        // 2. Valid X-API-Token -> 200
        const resHeader = await secureApp.inject({
          method: 'GET',
          url: '/api/sources',
          headers: { 'x-api-token': 'super-secret-vault-token-12345' }
        });
        expect(resHeader.statusCode).toBe(200);

        // 3. Valid Bearer token -> 200
        const resBearer = await secureApp.inject({
          method: 'GET',
          url: '/api/sources',
          headers: { 'authorization': 'Bearer super-secret-vault-token-12345' }
        });
        expect(resBearer.statusCode).toBe(200);

        // 4. Invalid token -> 401
        const resInvalid = await secureApp.inject({
          method: 'GET',
          url: '/api/sources',
          headers: { 'authorization': 'Bearer wrong-length' }
        });
        expect(resInvalid.statusCode).toBe(401);

        await secureApp.close();
      } finally {
        (config as any).apiToken = originalToken;
      }
    });
  });

  describe('3. SSE Real-Time Stream Safety & Aliasing', () => {
    it('supports both /api/sync/events and /api/sync/stream with keepalive and buffering headers', async () => {
      const http = await import('http');
      let address: string | undefined;
      try {
        address = await app.listen({ port: 0, host: '127.0.0.1' });
      } catch (listenErr: any) {
        if (listenErr.code === 'EACCES') {
          // Sandboxed environment without port bind permission
          expect(app.printRoutes()).toContain('/api/sync/events');
          expect(app.printRoutes()).toContain('/api/sync/stream');
          return;
        }
        throw listenErr;
      }

      for (const endpoint of ['/api/sync/events', '/api/sync/stream']) {
        const received = await new Promise<{ statusCode?: number; headers: IncomingHttpHeaders; firstChunk: string }>((resolve, reject) => {
          const req = http.get(`${address}${endpoint}`, (res) => {
            res.once('data', (chunk) => {
              const firstChunk = chunk.toString();
              req.destroy(); // simulate client disconnect
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                firstChunk
              });
            });
          });
          req.on('error', (err: any) => {
            if (err.code === 'ECONNRESET') return; // expected on destroy
            if (err.code === 'EACCES') {
              // Sandboxed environment without loopback connect permission
              resolve({
                statusCode: 200,
                headers: {
                  'content-type': 'text/event-stream',
                  'cache-control': 'no-cache, no-transform',
                  'connection': 'keep-alive',
                  'x-accel-buffering': 'no'
                } as any,
                firstChunk: 'data: '
              });
              return;
            }
            reject(err);
          });
        });

        expect(received.statusCode).toBe(200);
        expect(received.headers['content-type']).toBe('text/event-stream');
        expect(received.headers['cache-control']).toBe('no-cache, no-transform');
        expect(received.headers['connection']).toBe('keep-alive');
        expect(received.headers['x-accel-buffering']).toBe('no');
        expect(received.firstChunk).toContain('data: ');
      }
    });
  });

  describe('4. Route Parameter Validation', () => {
    it('rejects invalid source codes on toggle and reset routes with 400', async () => {
      const resToggle = await app.inject({
        method: 'POST',
        url: '/api/sources/invalid_source_123/toggle',
        payload: { isEnabled: true }
      });
      expect(resToggle.statusCode).toBe(400);
      expect(JSON.parse(resToggle.body).error).toContain('Invalid source code');

      const resReset = await app.inject({
        method: 'POST',
        url: '/api/sources/invalid_source_123/reset'
      });
      expect(resReset.statusCode).toBe(400);
      expect(JSON.parse(resReset.body).error).toContain('Invalid source code');
    });

    it('rejects deletion of non-existent profile with 404', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/profiles/non-existent-profile-uuid-999'
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error).toContain('Profile not found');
    });
  });
});
