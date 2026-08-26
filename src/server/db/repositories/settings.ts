import { prepareStmt } from '../core.js';

export const settingsRepo = {
  get(key: string): string | undefined {
    const row = prepareStmt(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
    return row?.value;
  },

  set(key: string, value: string): void {
    const now = new Date().toISOString();
    prepareStmt(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, now);
  },

  getAll(): Record<string, string> {
    const rows = prepareStmt(`SELECT key, value FROM settings`).all() as any[];
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  }
};
