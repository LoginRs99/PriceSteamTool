import { prepareStmt } from '../core.js';

export interface SyncRunRecord {
  id: string;
  triggerType: 'MANUAL' | 'SCHEDULED' | 'STARTUP';
  status: string;
  startedAt: string;
  completedAt?: string;
  totalGames: number;
  processedGames: number;
  offersFound: number;
  offersUpdated: number;
  errorMessage?: string;
}

export const syncRunRepo = {
  create(run: SyncRunRecord): void {
    prepareStmt(`
      INSERT INTO sync_runs (
        id, trigger_type, status, started_at, completed_at,
        total_games, processed_games, offers_found, offers_updated, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.triggerType,
      run.status,
      run.startedAt,
      run.completedAt || null,
      run.totalGames,
      run.processedGames,
      run.offersFound,
      run.offersUpdated,
      run.errorMessage || null
    );
  },

  update(id: string, updates: Partial<Omit<SyncRunRecord, 'id'>>): void {
    const existing = this.getById(id);
    if (!existing) return;

    const merged = { ...existing, ...updates };
    prepareStmt(`
      UPDATE sync_runs
      SET status = ?,
          completed_at = ?,
          total_games = ?,
          processed_games = ?,
          offers_found = ?,
          offers_updated = ?,
          error_message = ?
      WHERE id = ?
    `).run(
      merged.status,
      merged.completedAt || null,
      merged.totalGames,
      merged.processedGames,
      merged.offersFound,
      merged.offersUpdated,
      merged.errorMessage || null,
      id
    );
  },

  getById(id: string): SyncRunRecord | null {
    const row = prepareStmt(`SELECT * FROM sync_runs WHERE id = ?`).get(id) as any;
    if (!row) return null;
    return this.mapRow(row);
  },

  getLatest(): SyncRunRecord | null {
    const row = prepareStmt(`SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 1`).get() as any;
    if (!row) return null;
    return this.mapRow(row);
  },

  list(limit: number = 20): SyncRunRecord[] {
    const rows = prepareStmt(`SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?`).all(limit) as any[];
    return rows.map(r => this.mapRow(r));
  },

  mapRow(row: any): SyncRunRecord {
    return {
      id: row.id,
      triggerType: row.trigger_type,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      totalGames: Number(row.total_games || 0),
      processedGames: Number(row.processed_games || 0),
      offersFound: Number(row.offers_found || 0),
      offersUpdated: Number(row.offers_updated || 0),
      errorMessage: row.error_message || undefined
    };
  }
};
