import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, MIGRATIONS } from '../../src/server/db/migrations.js';

import { SCHEMA_SQL } from '../../src/server/db/schema.js';

describe('Database Versioned Migrations Runner', () => {
  it('creates schema_migrations table and records all migrations on fresh database', () => {
    const db = new Database(':memory:');
    
    // Initial base schema
    db.exec(SCHEMA_SQL);

    runMigrations(db);

    const applied = db.prepare(`SELECT name FROM schema_migrations ORDER BY id ASC`).all() as { name: string }[];
    expect(applied.length).toBe(MIGRATIONS.length);
    expect(applied.map(a => a.name)).toEqual(MIGRATIONS.map(m => m.name));

    // Verify columns exist on tables
    const offerCols = db.prepare(`PRAGMA table_info(offers)`).all() as any[];
    const offerColNames = offerCols.map(c => c.name);
    expect(offerColNames).toContain('price_event');
    expect(offerColNames).toContain('risk_level');
    expect(offerColNames).toContain('is_anomaly');

    // Second run: should be a no-op and not duplicate entries
    runMigrations(db);
    const appliedAfterSecondRun = db.prepare(`SELECT name FROM schema_migrations`).all() as { name: string }[];
    expect(appliedAfterSecondRun.length).toBe(MIGRATIONS.length);

    db.close();
  });
});
