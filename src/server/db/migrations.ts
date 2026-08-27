import type Database from 'better-sqlite3';
import { BEST_DEAL_RECOMPUTE_ALL_SQL } from './core.js';

export interface Migration {
  name: string;
  up: (db: Database.Database) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    name: '001_add_offers_risk_and_price_event_columns',
    up: (db) => {
      try { db.exec("ALTER TABLE offers ADD COLUMN price_event TEXT NOT NULL DEFAULT 'NONE'"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE offers ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'SAFE'"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE offers ADD COLUMN risk_score REAL NOT NULL DEFAULT 0.0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE offers ADD COLUMN risk_flags TEXT"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE offers ADD COLUMN evaluation_confidence REAL NOT NULL DEFAULT 1.0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
    }
  },
  {
    name: '002_add_offers_raw_price_and_observation_columns',
    up: (db) => {
      try { db.exec("ALTER TABLE offers ADD COLUMN raw_price REAL"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE offers ADD COLUMN raw_currency TEXT DEFAULT 'EUR'"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE offers ADD COLUMN raw_original_price REAL"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE offers ADD COLUMN last_observed_at TEXT"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
    }
  },
  {
    name: '003_add_offers_anomaly_columns',
    up: (db) => {
      try { db.exec("ALTER TABLE offers ADD COLUMN is_anomaly INTEGER NOT NULL DEFAULT 0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE offers ADD COLUMN anomaly_score REAL NOT NULL DEFAULT 0.0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE offers ADD COLUMN anomaly_reason TEXT"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
    }
  },
  {
    name: '004_add_source_observations_and_price_history_columns',
    up: (db) => {
      try { db.exec("ALTER TABLE source_observations ADD COLUMN observed_raw_price REAL"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE source_observations ADD COLUMN observed_currency TEXT DEFAULT 'EUR'"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE price_history ADD COLUMN price_event TEXT"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE price_history ADD COLUMN deal_score INTEGER"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
    }
  },
  {
    name: '005_create_offers_indexes',
    up: (db) => {
      db.exec("CREATE INDEX IF NOT EXISTS idx_offers_risk_level ON offers(risk_level)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_offers_price_event ON offers(price_event)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_offers_game_valid_price ON offers(game_id, is_valid, price_eur)");
    }
  },
  {
    name: '006_add_games_statistical_deal_score_columns',
    up: (db) => {
      try { db.exec("ALTER TABLE games ADD COLUMN typical_sale_median_eur REAL"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN typical_sale_q1_eur REAL"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN typical_sale_q3_eur REAL"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN typical_sale_sample_count INTEGER"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN typical_sale_low_confidence INTEGER"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN low_90d_eur REAL"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN low_1y_eur REAL"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN atl_is_confirmed INTEGER DEFAULT 1"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN atl_is_single_source_low INTEGER DEFAULT 0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN price_tracking_first_observed_at TEXT"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN best_offer_source_count INTEGER"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN deal_score_stats_updated_at TEXT"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
    }
  },
  {
    name: '007_add_allkeyshop_and_target_price_columns',
    up: (db) => {
      try { db.exec("ALTER TABLE games ADD COLUMN allkeyshop_last_checked_at TEXT"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN allkeyshop_check_interval_hours INTEGER DEFAULT 24"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN allkeyshop_unchanged_streak INTEGER DEFAULT 0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN allkeyshop_last_price_eur REAL"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE wishlist_entries ADD COLUMN target_price_eur REAL"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
    }
  },
  {
    name: '008_cleanup_legacy_non_steam_offers',
    up: (db) => {
      db.exec(`
        DELETE FROM offers WHERE merchant_id IN (
          SELECT id FROM merchants WHERE 
            LOWER(name) LIKE '%gog%' OR 
            LOWER(name) LIKE '%epic games%' OR 
            LOWER(name) LIKE '%origin%' OR 
            LOWER(name) LIKE '%uplay%' OR 
            LOWER(name) LIKE '%ubisoft store%' OR 
            LOWER(name) LIKE '%blizzard%' OR 
            LOWER(name) LIKE '%battle.net%'
        );
      `);
      db.exec(BEST_DEAL_RECOMPUTE_ALL_SQL);
    }
  },
  {
    name: '009_cleanup_borderlands_mismatch_offers',
    up: (db) => {
      db.exec(`
        DELETE FROM offers WHERE id IN (
          SELECT o.id FROM offers o
          JOIN games g ON o.game_id = g.id
          WHERE (LOWER(o.deal_url) LIKE '%borderlands%' AND LOWER(g.title) NOT LIKE '%borderlands%')
             OR (o.merchant_id IN (SELECT id FROM merchants WHERE LOWER(code) IN ('allkeyshop', 'allkeyshopbest', 'kinguin') AND LOWER(g.title) NOT LIKE '%borderlands%'))
        );
      `);
      db.exec(BEST_DEAL_RECOMPUTE_ALL_SQL);
    }
  },
  {
    name: '010_cleanup_orphaned_offers',
    up: (db) => {
      db.exec(`
        DELETE FROM offers WHERE id NOT IN (SELECT DISTINCT offer_id FROM source_observations);
      `);
      db.exec(BEST_DEAL_RECOMPUTE_ALL_SQL);
    }
  },
  {
    name: '011_add_price_history_currency_and_fx_columns',
    up: (db) => {
      try { db.exec("ALTER TABLE price_history ADD COLUMN raw_price REAL"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE price_history ADD COLUMN raw_currency TEXT DEFAULT 'EUR'"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE price_history ADD COLUMN fx_rate REAL DEFAULT 1.0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
    }
  }
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare(`SELECT name FROM schema_migrations`).all() as { name: string }[];
  const appliedSet = new Set(appliedRows.map(r => r.name));

  const insertStmt = db.prepare(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`);

  for (const migration of MIGRATIONS) {
    if (appliedSet.has(migration.name)) continue;

    const tx = db.transaction(() => {
      migration.up(db);
      insertStmt.run(migration.name, new Date().toISOString());
    });

    try {
      tx();
    } catch (err: any) {
      console.error(`[Database Migration Error] Failed to execute migration "${migration.name}":`, err.message);
      throw err;
    }
  }
}
