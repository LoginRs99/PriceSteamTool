import type Database from 'better-sqlite3';
import { BEST_DEAL_RECOMPUTE_ALL_SQL } from './core.js';
import { calculateSteamDbRating } from '../domain/rating.js';

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
  },
  {
    name: '012_add_price_history_anomaly_and_source_cooldown_columns',
    up: (db) => {
      try { db.exec("ALTER TABLE price_history ADD COLUMN is_anomaly INTEGER NOT NULL DEFAULT 0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE price_history ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'SAFE'"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE sources ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE sources ADD COLUMN consecutive_rate_limits INTEGER NOT NULL DEFAULT 0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      db.exec("CREATE INDEX IF NOT EXISTS idx_price_history_trusted ON price_history(game_id, is_anomaly, risk_level)");
    }
  },
  {
    name: '013_add_foreign_key_and_lookup_indexes',
    up: (db) => {
      db.exec("CREATE INDEX IF NOT EXISTS idx_offers_merchant_id ON offers(merchant_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_price_history_merchant ON price_history(merchant_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_wishlist_game_id ON wishlist_entries(game_id)");
    }
  },
  {
    name: '014_purge_false_high_risk_and_recompute_deals',
    up: (db) => {
      // 1. Reset offers that were falsely flagged as HIGH risk due to price increases or high prices
      try {
        db.exec(`
          UPDATE offers
          SET risk_level = 'SAFE',
              risk_score = 0.0,
              is_anomaly = 0,
              anomaly_score = 0.0,
              anomaly_reason = NULL
          WHERE risk_level = 'HIGH'
            AND (price_event = 'PRICE_INCREASE' OR price_eur >= 10.0 OR (original_price_eur IS NOT NULL AND price_eur >= original_price_eur));
        `);
      } catch {}

      // 2. Resolve/dismiss corresponding false active anomaly records
      try {
        db.exec(`
          UPDATE anomalies
          SET is_dismissed = 1
          WHERE offer_id IN (
            SELECT id FROM offers WHERE risk_level != 'HIGH' AND is_anomaly = 0
          ) AND is_dismissed = 0;
        `);
      } catch {}

      // 3. Recompute best deal assignment across all games
      try {
        db.exec(BEST_DEAL_RECOMPUTE_ALL_SQL);
      } catch {}
    }
  },
  {
    name: '015_add_steam_review_columns',
    up: (db) => {
      try { db.exec("ALTER TABLE games ADD COLUMN steam_review_desc TEXT"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN steam_review_percent INTEGER"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN steam_review_total TEXT"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
    }
  },
  {
    name: '016_add_family_sharing_support',
    up: (db) => {
      try { db.exec("ALTER TABLE profiles ADD COLUMN is_family INTEGER NOT NULL DEFAULT 0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      db.exec(`
        CREATE TABLE IF NOT EXISTS family_owned_apps (
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          steam_app_id INTEGER NOT NULL,
          synced_at TEXT NOT NULL,
          PRIMARY KEY (profile_id, steam_app_id)
        );
        CREATE INDEX IF NOT EXISTS idx_family_owned_apps_app_id ON family_owned_apps(steam_app_id);
      `);
    }
  },
  {
    name: '017_add_steamdb_and_metacritic_ratings',
    up: (db) => {
      try { db.exec("ALTER TABLE games ADD COLUMN steamdb_rating REAL"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN metacritic_score INTEGER"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
      try { db.exec("ALTER TABLE games ADD COLUMN metacritic_url TEXT"); } catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }

      try {
        const games = db.prepare(`
          SELECT id, steam_review_percent, steam_review_total 
          FROM games 
          WHERE steam_review_percent IS NOT NULL AND steam_review_total IS NOT NULL
        `).all() as Array<{ id: string; steam_review_percent: number; steam_review_total: string }>;

        const updateStmt = db.prepare(`UPDATE games SET steamdb_rating = ? WHERE id = ?`);
        for (const g of games) {
          const rating = calculateSteamDbRating(g.steam_review_percent, g.steam_review_total);
          if (rating !== undefined) {
            updateStmt.run(rating, g.id);
          }
        }
      } catch (err: any) {
        console.warn('[Migration 017] SteamDB rating backfill notice:', err?.message);
      }
    }
  },
  {
    name: '018_update_steam_cdn_image_urls',
    up: (db) => {
      try {
        db.exec(`
          UPDATE games 
          SET header_image = 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/' || steam_app_id || '/header.jpg'
          WHERE header_image IS NULL OR header_image LIKE '%cdn.akamai.steamstatic.com%' OR header_image LIKE '%capsule_sm_120%';

          UPDATE games 
          SET capsule_image = 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/' || steam_app_id || '/capsule_231x87.jpg'
          WHERE capsule_image IS NULL OR capsule_image LIKE '%cdn.akamai.steamstatic.com%';
        `);
      } catch (err: any) {
        console.warn('[Migration 018] Steam CDN image URLs update notice:', err?.message);
      }
    }
  },
  {
    name: '019_purge_false_sub_euro_glitches',
    up: (db) => {
      try {
        // 1. Reset offers that were falsely flagged as SUB_EURO_PREMIUM_GLITCH on catalog games (MSRP < 15 EUR with price >= msrp * 0.05)
        db.exec(`
          UPDATE offers
          SET risk_level = 'SAFE',
              risk_score = 0.0,
              is_anomaly = 0,
              anomaly_score = 0.0,
              anomaly_reason = NULL
          WHERE is_anomaly = 1
            AND (risk_flags LIKE '%SUB_EURO_PREMIUM_GLITCH%' OR anomaly_reason LIKE '%Sub-Euro%')
            AND game_id IN (
              SELECT id FROM games 
              WHERE (base_price_eur IS NOT NULL AND base_price_eur < 15.0 AND offers.price_eur >= base_price_eur * 0.05)
            );

          -- 2. Dismiss corresponding anomaly records
          UPDATE anomalies
          SET is_dismissed = 1
          WHERE offer_id IN (
            SELECT id FROM offers WHERE risk_level != 'HIGH' AND is_anomaly = 0
          ) AND is_dismissed = 0;

          -- 3. Recompute best deal assignment
          ${BEST_DEAL_RECOMPUTE_ALL_SQL}
        `);
      } catch (err: any) {
        console.warn('[Migration 019] Notice:', err?.message);
      }
    }
  },
  {
    name: '020_add_source_observations_offer_source_index',
    up: (db) => {
      try {
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_observations_offer_source ON source_observations(offer_id, source_code);
          UPDATE offers 
          SET deal_url = 'https://' || ltrim(deal_url, '/') 
          WHERE deal_url NOT LIKE 'http://%' AND deal_url NOT LIKE 'https://%';
          ${BEST_DEAL_RECOMPUTE_ALL_SQL}
        `);
      } catch (err: any) {
        console.warn('[Migration 020] Notice:', err?.message);
      }
    }
  },
  {
    name: '021_add_price_history_seeded_at',
    up: (db) => {
      try {
        db.exec("ALTER TABLE games ADD COLUMN price_history_seeded_at TEXT");
      } catch (e: any) {
        if (!e.message?.includes('duplicate column')) throw e;
      }
    }
  },
  {
    name: '022_pricing_error_detector',
    up: (db) => {
      // 1. Migrate legacy anomalies table to pricing_errors via copy-then-drop
      try {
        const hasOldTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='anomalies'").get();
        if (hasOldTable) {
          try {
            db.exec(`
              CREATE TABLE IF NOT EXISTS pricing_errors (
                id TEXT PRIMARY KEY,
                game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
                offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
                error_type TEXT NOT NULL,
                confidence REAL NOT NULL,
                reason TEXT NOT NULL,
                detected_at TEXT NOT NULL,
                is_dismissed INTEGER NOT NULL DEFAULT 0
              );
            `);
          } catch (e: any) {
            console.warn('[Migration 022] pricing_errors create notice:', e?.message);
          }

          try {
            db.exec(`
              INSERT OR IGNORE INTO pricing_errors (id, game_id, offer_id, error_type, confidence, reason, detected_at, is_dismissed)
              SELECT id, game_id, offer_id, COALESCE(anomaly_type, 'PRICE_GLITCH'), COALESCE(score, 0.0), COALESCE(reason, ''), detected_at, COALESCE(is_dismissed, 0)
              FROM anomalies;
            `);
          } catch (e: any) {
            console.warn('[Migration 022] anomalies copy notice:', e?.message);
          }

          try {
            db.exec("DROP TABLE anomalies;");
          } catch (e: any) {
            console.warn('[Migration 022] anomalies drop notice:', e?.message);
          }

          try {
            db.exec(`
              CREATE VIEW IF NOT EXISTS anomalies AS 
              SELECT 
                id, 
                game_id, 
                offer_id, 
                error_type AS anomaly_type, 
                confidence AS score, 
                reason, 
                detected_at, 
                is_dismissed 
              FROM pricing_errors;
            `);
          } catch (e: any) {
            console.warn('[Migration 022] anomalies compat view notice:', e?.message);
          }

          try {
            db.exec(`
              CREATE TRIGGER IF NOT EXISTS trg_delete_anomalies INSTEAD OF DELETE ON anomalies BEGIN
                DELETE FROM pricing_errors WHERE id = OLD.id;
              END;
            `);
          } catch (e: any) {
            console.warn('[Migration 022] trg_delete_anomalies notice:', e?.message);
          }

          try {
            db.exec(`
              CREATE TRIGGER IF NOT EXISTS trg_update_anomalies INSTEAD OF UPDATE ON anomalies BEGIN
                UPDATE pricing_errors 
                SET is_dismissed = NEW.is_dismissed,
                    error_type = COALESCE(NEW.anomaly_type, error_type),
                    confidence = COALESCE(NEW.score, confidence),
                    reason = COALESCE(NEW.reason, reason),
                    detected_at = COALESCE(NEW.detected_at, detected_at)
                WHERE id = OLD.id;
              END;
            `);
          } catch (e: any) {
            console.warn('[Migration 022] trg_update_anomalies notice:', e?.message);
          }

          try {
            db.exec(`
              CREATE TRIGGER IF NOT EXISTS trg_insert_anomalies INSTEAD OF INSERT ON anomalies BEGIN
                INSERT INTO pricing_errors (id, game_id, offer_id, error_type, confidence, reason, detected_at, is_dismissed)
                VALUES (NEW.id, NEW.game_id, NEW.offer_id, NEW.anomaly_type, NEW.score, NEW.reason, NEW.detected_at, NEW.is_dismissed);
              END;
            `);
          } catch (e: any) {
            console.warn('[Migration 022] trg_insert_anomalies notice:', e?.message);
          }
        }
      } catch (err: any) {
        console.warn('[Migration 022] anomalies migration check notice:', err?.message);
      }

      // Ensure pricing_errors table structure
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS pricing_errors (
            id TEXT PRIMARY KEY,
            game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
            error_type TEXT NOT NULL,
            confidence REAL NOT NULL,
            reason TEXT NOT NULL,
            detected_at TEXT NOT NULL,
            is_dismissed INTEGER NOT NULL DEFAULT 0
          );
        `);
      } catch (err: any) {
        console.warn('[Migration 022] pricing_errors create notice:', err?.message);
      }

      // Recreate pricing_errors indexes
      try { db.exec("DROP INDEX IF EXISTS idx_anomalies_game"); } catch {}
      try { db.exec("DROP INDEX IF EXISTS idx_anomalies_dismissed"); } catch {}
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_pricing_errors_game ON pricing_errors(game_id)"); } catch {}
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_pricing_errors_dismissed ON pricing_errors(is_dismissed)"); } catch {}

      // 2. Add offers pricing error columns
      try { db.exec("ALTER TABLE offers ADD COLUMN is_likely_pricing_error INTEGER NOT NULL DEFAULT 0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) console.warn(e.message); }
      try { db.exec("ALTER TABLE offers ADD COLUMN pricing_error_confidence REAL NOT NULL DEFAULT 0.0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) console.warn(e.message); }
      try { db.exec("ALTER TABLE offers ADD COLUMN pricing_error_type TEXT"); } catch (e: any) { if (!e.message?.includes('duplicate column')) console.warn(e.message); }
      try { db.exec("ALTER TABLE offers ADD COLUMN pricing_error_reason TEXT"); } catch (e: any) { if (!e.message?.includes('duplicate column')) console.warn(e.message); }

      // Backfill offers columns from legacy columns
      try {
        db.exec(`
          UPDATE offers
          SET is_likely_pricing_error = COALESCE(is_likely_pricing_error, is_anomaly, 0),
              pricing_error_confidence = COALESCE(pricing_error_confidence, anomaly_score, 0.0),
              pricing_error_reason = COALESCE(pricing_error_reason, anomaly_reason)
          WHERE is_anomaly = 1 OR anomaly_score > 0
        `);
      } catch {}

      // Drop legacy columns from offers
      try { db.exec("ALTER TABLE offers DROP COLUMN risk_level"); } catch {}
      try { db.exec("ALTER TABLE offers DROP COLUMN risk_score"); } catch {}
      try { db.exec("ALTER TABLE offers DROP COLUMN risk_flags"); } catch {}
      try { db.exec("ALTER TABLE offers DROP COLUMN evaluation_confidence"); } catch {}
      try { db.exec("ALTER TABLE offers DROP COLUMN is_anomaly"); } catch {}
      try { db.exec("ALTER TABLE offers DROP COLUMN anomaly_score"); } catch {}
      try { db.exec("ALTER TABLE offers DROP COLUMN anomaly_reason"); } catch {}

      // Recreate offers indexes
      try { db.exec("DROP INDEX IF EXISTS idx_offers_risk_level"); } catch {}
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_offers_pricing_error ON offers(is_likely_pricing_error)"); } catch {}

      // 3. Update price_history: add is_pricing_error and backfill from is_anomaly
      try { db.exec("ALTER TABLE price_history ADD COLUMN is_pricing_error INTEGER NOT NULL DEFAULT 0"); } catch (e: any) { if (!e.message?.includes('duplicate column')) console.warn(e.message); }
      try {
        db.exec(`UPDATE price_history SET is_pricing_error = COALESCE(is_anomaly, 0) WHERE is_pricing_error = 0 AND is_anomaly = 1`);
      } catch {}

      try { db.exec("ALTER TABLE price_history DROP COLUMN risk_level"); } catch {}
      try { db.exec("ALTER TABLE price_history DROP COLUMN is_anomaly"); } catch {}

      // Recreate price_history indexes
      try { db.exec("DROP INDEX IF EXISTS idx_price_history_trusted"); } catch {}
      try { db.exec("CREATE INDEX IF NOT EXISTS idx_price_history_reliable ON price_history(game_id, is_pricing_error)"); } catch {}

      // 4. Create steam_assets table
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS steam_assets (
            steam_app_id INTEGER NOT NULL,
            asset_type TEXT NOT NULL,
            asset_url TEXT NOT NULL,
            local_path TEXT,
            last_updated_at TEXT NOT NULL,
            PRIMARY KEY (steam_app_id, asset_type)
          );
          CREATE INDEX IF NOT EXISTS idx_steam_assets_app ON steam_assets(steam_app_id);
        `);
      } catch {}
    }
  },
  {
    name: '023_drop_merchant_trust_score',
    up: (db) => {
      try {
        db.exec("ALTER TABLE merchants DROP COLUMN trust_score");
      } catch (e: any) {
        if (!e.message?.includes('no such column')) {
          console.warn('[Migration 023] merchants drop trust_score notice:', e.message);
        }
      }
    }
  },
  {
    name: '024_post_migration_indexes_and_anomalies_view',
    up: (db) => {
      // a. CREATE INDEX IF NOT EXISTS idx_offers_pricing_error ON offers(is_likely_pricing_error)
      try {
        db.exec("CREATE INDEX IF NOT EXISTS idx_offers_pricing_error ON offers(is_likely_pricing_error)");
      } catch (err: any) {
        console.warn('[Migration 024] idx_offers_pricing_error notice:', err?.message);
      }

      // b. CREATE INDEX IF NOT EXISTS idx_price_history_reliable ON price_history(game_id, is_pricing_error)
      try {
        db.exec("CREATE INDEX IF NOT EXISTS idx_price_history_reliable ON price_history(game_id, is_pricing_error)");
      } catch (err: any) {
        console.warn('[Migration 024] idx_price_history_reliable notice:', err?.message);
      }

      // c. Legacy safety net: check if anomalies is still a TABLE
      try {
        const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='anomalies'").get();
        if (tableCheck) {
          db.exec(`
            INSERT OR IGNORE INTO pricing_errors (id, game_id, offer_id, error_type, confidence, reason, detected_at, is_dismissed)
            SELECT id, game_id, offer_id, COALESCE(anomaly_type,'PRICE_GLITCH'), COALESCE(score,0.0), COALESCE(reason,''), detected_at, COALESCE(is_dismissed,0)
            FROM anomalies;
          `);
          db.exec("DROP TABLE anomalies");
        }
      } catch (err: any) {
        console.warn('[Migration 024] legacy anomalies table safety net notice:', err?.message);
      }

      // d. CREATE VIEW IF NOT EXISTS anomalies
      try {
        db.exec(`
          CREATE VIEW IF NOT EXISTS anomalies AS 
          SELECT 
            id, 
            game_id, 
            offer_id, 
            error_type AS anomaly_type, 
            confidence AS score, 
            reason, 
            detected_at, 
            is_dismissed 
          FROM pricing_errors;
        `);
      } catch (err: any) {
        console.warn('[Migration 024] anomalies view create notice:', err?.message);
      }

      // e. Re-create the three INSTEAD OF triggers
      try {
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_delete_anomalies INSTEAD OF DELETE ON anomalies BEGIN
            DELETE FROM pricing_errors WHERE id = OLD.id;
          END;
        `);
      } catch (err: any) {
        console.warn('[Migration 024] trg_delete_anomalies notice:', err?.message);
      }

      try {
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_update_anomalies INSTEAD OF UPDATE ON anomalies BEGIN
            UPDATE pricing_errors 
            SET is_dismissed = NEW.is_dismissed,
                error_type = COALESCE(NEW.anomaly_type, error_type),
                confidence = COALESCE(NEW.score, confidence),
                reason = COALESCE(NEW.reason, reason),
                detected_at = COALESCE(NEW.detected_at, detected_at)
            WHERE id = OLD.id;
          END;
        `);
      } catch (err: any) {
        console.warn('[Migration 024] trg_update_anomalies notice:', err?.message);
      }

      try {
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_insert_anomalies INSTEAD OF INSERT ON anomalies BEGIN
            INSERT INTO pricing_errors (id, game_id, offer_id, error_type, confidence, reason, detected_at, is_dismissed)
            VALUES (NEW.id, NEW.game_id, NEW.offer_id, NEW.anomaly_type, NEW.score, NEW.reason, NEW.detected_at, NEW.is_dismissed);
          END;
        `);
      } catch (err: any) {
        console.warn('[Migration 024] trg_insert_anomalies notice:', err?.message);
      }
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
