import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { sanitizeSecrets, logInfo, logWarn, logError, getRecentDiagnosticsLogs } from '../../src/server/utils/logger.js';
import { safeFetchJson } from '../../src/server/sources/base.js';

describe('Secret Sanitization and Logging Safety', () => {
  it('redacts API keys and tokens from query strings', () => {
    const input = 'https://api.isthereanydeal.com/games/lookup/v1?key=super_secret_itad_12345&appid=1091500';
    const output = sanitizeSecrets(input);
    expect(output).toBe('https://api.isthereanydeal.com/games/lookup/v1?key=[REDACTED]&appid=1091500');
    expect(output).not.toContain('super_secret_itad_12345');
  });

  it('redacts api_key, apiKey, token, and auth parameters', () => {
    const input = 'https://example.com/api?api_key=secretKey1&token=bearerToken99&auth=authVal123';
    const output = sanitizeSecrets(input);
    expect(output).toContain('api_key=[REDACTED]');
    expect(output).toContain('token=[REDACTED]');
    expect(output).toContain('auth=[REDACTED]');
    expect(output).not.toContain('secretKey1');
    expect(output).not.toContain('bearerToken99');
    expect(output).not.toContain('authVal123');
  });

  it('redacts key-value pairs in text and JSON error bodies', () => {
    const jsonBody = '{"error": "Failed for key=dummy_itad_key_12345", "token": "dummy_secret_token_999"}';
    const output = sanitizeSecrets(jsonBody);
    expect(output).toContain('"error": "Failed for key=[REDACTED]"');
    expect(output).toContain('"token": "[REDACTED]"');
    expect(output).not.toContain('dummy_itad_key_12345');
    expect(output).not.toContain('dummy_secret_token_999');
  });

  it('redacts Authorization Bearer tokens in headers or logs', () => {
    const input = 'Request headers: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID';
    const output = sanitizeSecrets(input);
    expect(output).toBe('Request headers: Authorization: Bearer [REDACTED]');
  });

  it('redacts Discord webhook URLs containing webhook tokens', () => {
    const input = 'Failed to post alert: https://discord.com/api/webhooks/1234567890/abc-DEF_ghi-JKL_987654321';
    const output = sanitizeSecrets(input);
    expect(output).toBe('Failed to post alert: https://discord.com/api/webhooks/1234567890/[REDACTED]');
    expect(output).not.toContain('abc-DEF_ghi-JKL_987654321');
  });

  it('redacts secrets from exception stack traces and error messages', () => {
    const sensitiveUrl = 'https://api.isthereanydeal.com/v1?key=dummy_itad_key_12345';
    const err = new Error(`Connection timeout for ${sensitiveUrl}`);
    const sanitizedMsg = sanitizeSecrets(err.message);
    const sanitizedStack = sanitizeSecrets(err.stack || '');

    expect(sanitizedMsg).not.toContain('dummy_itad_key_12345');
    expect(sanitizedMsg).toContain('key=[REDACTED]');
    expect(sanitizedStack).not.toContain('dummy_itad_key_12345');
  });

  it('redacts secret credentials in outbound safeFetchJson error messages and bodies', async () => {
    const dummyKey = 'dummy_itad_key_12345';
    const dummySecretToken = 'dummy_webhook_token_999';
    const targetUrl = `https://httpbin.org/status/500?key=${dummyKey}&token=${dummySecretToken}`;

    // Mock global fetch to simulate a 500 error echoing credentials in response body
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({
        error: `Failed for key=${dummyKey}`,
        token: dummySecretToken
      })
    }) as any;

    try {
      await expect(safeFetchJson(targetUrl, {}, 1000)).rejects.toThrow();
      try {
        await safeFetchJson(targetUrl, {}, 1000);
      } catch (err: any) {
        expect(err.message).not.toContain(dummyKey);
        expect(err.message).not.toContain(dummySecretToken);
        expect(err.message).toContain('key=[REDACTED]');
        expect(err.body).not.toContain(dummyKey);
        expect(err.body).not.toContain(dummySecretToken);
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('verifies that logging redaction is applied at ingestion before console output', () => {
    const dummyKey = 'dummy_itad_key_998877';
    const dummyWebhook = 'https://discord.com/api/webhooks/999888777/secret_token_12345';
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      logInfo(`Ingesting feed from https://api.itad.com/v1?key=${dummyKey}`);
      logError(`Failed request to ${dummyWebhook}`);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('key=[REDACTED]'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.not.stringContaining(dummyKey));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('https://discord.com/api/webhooks/999888777/[REDACTED]'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.not.stringContaining('secret_token_12345'));
    } finally {
      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it('verifies getRecentDiagnosticsLogs applies defense-in-depth sanitization on log export', () => {
    const rawLogLine = '[2026-11-12T00:00:00.000Z] [ERROR] Unhandled error at https://api.itad.com/v1?key=leaked_legacy_key_777';
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(rawLogLine);
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    try {
      const logs = getRecentDiagnosticsLogs(10);
      expect(logs).not.toContain('leaked_legacy_key_777');
      expect(logs).toContain('key=[REDACTED]');
    } finally {
      readSpy.mockRestore();
      existsSpy.mockRestore();
    }
  });
});
