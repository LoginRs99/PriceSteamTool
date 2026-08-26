import { randomUUID } from 'crypto';
import { prepareStmt } from '../core.js';
import type { Merchant } from '../../../shared/types.js';

export const merchantRepo = {
  getOrCreate(code: string, name: string, isOfficial: boolean = true, defaultUrl?: string): Merchant {
    const row = prepareStmt(`SELECT * FROM merchants WHERE code = ?`).get(code) as any;
    if (row) {
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        defaultUrl: row.default_url || undefined,
        isOfficial: Boolean(row.is_official),
        trustScore: Number(row.trust_score)
      };
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    prepareStmt(`
      INSERT INTO merchants (id, code, name, default_url, is_official, trust_score, created_at)
      VALUES (?, ?, ?, ?, ?, 1.0, ?)
    `).run(id, code, name, defaultUrl || null, isOfficial ? 1 : 0, now);

    return { id, code, name, defaultUrl, isOfficial, trustScore: 1.0 };
  },

  list(): Merchant[] {
    const rows = prepareStmt(`SELECT * FROM merchants ORDER BY is_official DESC, name ASC`).all() as any[];
    return rows.map(r => ({
      id: r.id,
      code: r.code,
      name: r.name,
      defaultUrl: r.default_url || undefined,
      isOfficial: Boolean(r.is_official),
      trustScore: Number(r.trust_score)
    }));
  }
};
