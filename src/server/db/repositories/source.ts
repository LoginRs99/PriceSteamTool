import { prepareStmt } from '../core.js';
import type { SourceStatus, SourceCode, CircuitState } from '../../../shared/types.js';

export const sourceRepo = {
  list(): SourceStatus[] {
    const rows = prepareStmt(`SELECT * FROM sources ORDER BY priority ASC`).all() as any[];
    return rows.map(r => ({
      code: r.code as SourceCode,
      name: r.name,
      isEnabled: Boolean(r.is_enabled),
      priority: Number(r.priority),
      state: r.state as CircuitState,
      requestCount: Number(r.request_count),
      successCount: Number(r.success_count),
      failureCount: Number(r.failure_count),
      rateLimitCount: Number(r.rate_limit_count),
      consecutiveFailures: Number(r.consecutive_failures || 0),
      consecutiveRateLimits: Number(r.consecutive_rate_limits || 0),
      lastSuccessAt: r.last_success_at || undefined,
      lastError: r.last_error || undefined,
      cooldownUntil: r.cooldown_until || undefined
    }));
  },

  getByCode(code: SourceCode): SourceStatus | null {
    const r = prepareStmt(`SELECT * FROM sources WHERE code = ?`).get(code) as any;
    if (!r) return null;
    return {
      code: r.code as SourceCode,
      name: r.name,
      isEnabled: Boolean(r.is_enabled),
      priority: Number(r.priority),
      state: r.state as CircuitState,
      requestCount: Number(r.request_count),
      successCount: Number(r.success_count),
      failureCount: Number(r.failure_count),
      rateLimitCount: Number(r.rate_limit_count),
      consecutiveFailures: Number(r.consecutive_failures || 0),
      consecutiveRateLimits: Number(r.consecutive_rate_limits || 0),
      lastSuccessAt: r.last_success_at || undefined,
      lastError: r.last_error || undefined,
      cooldownUntil: r.cooldown_until || undefined
    };
  },

  updateCircuitState(
    code: SourceCode,
    state: CircuitState,
    cooldownUntil?: string,
    consecutiveFailures: number = 0,
    consecutiveRateLimits: number = 0
  ): void {
    prepareStmt(`
      UPDATE sources
      SET state = ?,
          cooldown_until = ?,
          consecutive_failures = ?,
          consecutive_rate_limits = ?,
          updated_at = datetime('now')
      WHERE code = ?
    `).run(state, cooldownUntil || null, consecutiveFailures, consecutiveRateLimits, code);
  },

  incrementCounters(code: SourceCode, status: 'success' | 'failure' | 'ratelimit', errorMessage?: string, count: number = 1): void {
    const now = new Date().toISOString();
    const inc = Math.max(1, count);
    if (status === 'success') {
      prepareStmt(`
        UPDATE sources
        SET request_count = request_count + ?,
            success_count = success_count + ?,
            last_success_at = ?,
            updated_at = ?
        WHERE code = ?
      `).run(inc, inc, now, now, code);
    } else if (status === 'ratelimit') {
      prepareStmt(`
        UPDATE sources
        SET request_count = request_count + ?,
            rate_limit_count = rate_limit_count + ?,
            last_error = ?,
            updated_at = ?
        WHERE code = ?
      `).run(inc, inc, errorMessage || 'Rate limit encountered (429)', now, code);
    } else {
      prepareStmt(`
        UPDATE sources
        SET request_count = request_count + ?,
            failure_count = failure_count + ?,
            last_error = ?,
            updated_at = ?
        WHERE code = ?
      `).run(inc, inc, errorMessage || 'Request failed', now, code);
    }
  },

  toggle(code: SourceCode, isEnabled: boolean): void {
    prepareStmt(`UPDATE sources SET is_enabled = ?, updated_at = datetime('now') WHERE code = ?`).run(isEnabled ? 1 : 0, code);
  }
};
