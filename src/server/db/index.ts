import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { SCHEMA_SQL, SEED_SOURCES_SQL } from './schema.js';
import { evaluatePriceMovement, type PriceEvaluationInput } from '../domain/pricingEngine.js';
import { calculateDealScore } from '../domain/dealScore.js';
import { generateActionSignal } from '../domain/actionSignal.js';
import { generatePriceIntelligence, calculateTypicalSalePrice, calculatePeriodLows } from '../domain/priceIntelligence.js';
import type { 
  Profile, 
  Game, 
  Merchant, 
  Offer, 
  SourceCode, 
  CircuitState,
  SourceStatus,
  WishlistFilterOptions,
  WishlistStatistics,
  PriceHistoryEntry,
  Anomaly,
  PriceEventType,
  PriceRiskLevel,
  DealScoreTier,
  ConfidenceTier,
  PriceIntelligenceResponse,
  ActionSignal
} from '../../shared/types.js';

let dbInstance: Database.Database | null = null;
const stmtCache = new Map<string, Database.Statement>();

export const BEST_DEAL_RECOMPUTE_ALL_SQL = `
  -- Reset and reassign is_best_deal for all games using canonical priority (safe lowest > anomaly fallback)
  UPDATE offers SET is_best_deal = 0;
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY game_id 
      ORDER BY 
        CASE WHEN is_anomaly = 1 OR risk_level = 'HIGH' THEN 1 ELSE 0 END ASC,
        price_eur ASC
    ) as rn
    FROM offers
    WHERE is_valid = 1
  )
  UPDATE offers SET is_best_deal = 1 WHERE id IN (SELECT id FROM ranked WHERE rn = 1);
`;

export function getDb(): Database.Database {
  if (!dbInstance || !dbInstance.open) {
    dbInstance = new Database(config.dbPath);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('busy_timeout = 5000');
    dbInstance.pragma('foreign_keys = ON');
    dbInstance.exec(SCHEMA_SQL);
    dbInstance.exec(SEED_SOURCES_SQL);

    // Apply safe column migrations for existing databases
    try { dbInstance.exec("ALTER TABLE offers ADD COLUMN price_event TEXT NOT NULL DEFAULT 'NONE'"); } catch {}
    try { dbInstance.exec("ALTER TABLE offers ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'SAFE'"); } catch {}
    try { dbInstance.exec("ALTER TABLE offers ADD COLUMN risk_score REAL NOT NULL DEFAULT 0.0"); } catch {}
    try { dbInstance.exec("ALTER TABLE offers ADD COLUMN risk_flags TEXT"); } catch {}
    try { dbInstance.exec("ALTER TABLE offers ADD COLUMN evaluation_confidence REAL NOT NULL DEFAULT 1.0"); } catch {}
    try { dbInstance.exec("ALTER TABLE offers ADD COLUMN raw_price REAL"); } catch {}
    try { dbInstance.exec("ALTER TABLE offers ADD COLUMN raw_currency TEXT DEFAULT 'EUR'"); } catch {}
    try { dbInstance.exec("ALTER TABLE offers ADD COLUMN raw_original_price REAL"); } catch {}
    try { dbInstance.exec("ALTER TABLE offers ADD COLUMN last_observed_at TEXT"); } catch {}
    try { dbInstance.exec("ALTER TABLE offers ADD COLUMN is_anomaly INTEGER NOT NULL DEFAULT 0"); } catch {}
    try { dbInstance.exec("ALTER TABLE offers ADD COLUMN anomaly_score REAL NOT NULL DEFAULT 0.0"); } catch {}
    try { dbInstance.exec("ALTER TABLE offers ADD COLUMN anomaly_reason TEXT"); } catch {}
    try { dbInstance.exec("ALTER TABLE source_observations ADD COLUMN observed_raw_price REAL"); } catch {}
    try { dbInstance.exec("ALTER TABLE source_observations ADD COLUMN observed_currency TEXT DEFAULT 'EUR'"); } catch {}
    try { dbInstance.exec("ALTER TABLE price_history ADD COLUMN price_event TEXT"); } catch {}
    try { dbInstance.exec("ALTER TABLE price_history ADD COLUMN deal_score INTEGER"); } catch {}
    try { dbInstance.exec("CREATE INDEX IF NOT EXISTS idx_offers_risk_level ON offers(risk_level)"); } catch {}
    try { dbInstance.exec("CREATE INDEX IF NOT EXISTS idx_offers_price_event ON offers(price_event)"); } catch {}
    try { dbInstance.exec("CREATE INDEX IF NOT EXISTS idx_offers_game_valid_price ON offers(game_id, is_valid, price_eur)"); } catch {}

    // Deal Score v2 cached statistical columns on games
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN typical_sale_median_eur REAL"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN typical_sale_q1_eur REAL"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN typical_sale_q3_eur REAL"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN typical_sale_sample_count INTEGER"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN typical_sale_low_confidence INTEGER"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN low_90d_eur REAL"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN low_1y_eur REAL"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN atl_is_confirmed INTEGER DEFAULT 1"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN atl_is_single_source_low INTEGER DEFAULT 0"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN price_tracking_first_observed_at TEXT"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN best_offer_source_count INTEGER"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN deal_score_stats_updated_at TEXT"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN allkeyshop_last_checked_at TEXT"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN allkeyshop_check_interval_hours INTEGER DEFAULT 24"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN allkeyshop_unchanged_streak INTEGER DEFAULT 0"); } catch {}
    try { dbInstance.exec("ALTER TABLE games ADD COLUMN allkeyshop_last_price_eur REAL"); } catch {}
    try { dbInstance.exec("ALTER TABLE wishlist_entries ADD COLUMN target_price_eur REAL"); } catch {}

    // Clean up any legacy non-Steam offers (GOG, Epic, Origin, Uplay, Blizzard, etc.)
    try {
      dbInstance.exec(`
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

        -- Clean up fake Borderlands mismatched offers if any
        DELETE FROM offers WHERE id IN (
          SELECT o.id FROM offers o
          JOIN games g ON o.game_id = g.id
          WHERE (LOWER(o.deal_url) LIKE '%borderlands%' AND LOWER(g.title) NOT LIKE '%borderlands%')
             OR (o.merchant_id IN (SELECT id FROM merchants WHERE LOWER(code) IN ('allkeyshop', 'allkeyshopbest', 'kinguin') AND LOWER(g.title) NOT LIKE '%borderlands%'))
        );

        -- Delete any orphaned offers
        DELETE FROM offers WHERE id NOT IN (SELECT DISTINCT offer_id FROM source_observations);
      `);
      dbInstance.exec(BEST_DEAL_RECOMPUTE_ALL_SQL);
    } catch {}

    // Diagnostic: audit anomalies table content at startup to inspect stale records
    if (process.env.NODE_ENV !== 'test') {
      try {
        const rawAnomalies = dbInstance.prepare(`SELECT id, game_id, offer_id, anomaly_type, score, detected_at, is_dismissed FROM anomalies`).all();
        if (rawAnomalies.length > 0) {
          console.log(`[Data Safety] Startup anomalies table audit (${rawAnomalies.length} entries):`, JSON.stringify(rawAnomalies));
        }
      } catch {}
    }
  }
  return dbInstance;
}

/**
 * One-time backfill of Deal Score v2 stats for existing games in database
 */
export function backfillDealScoreStats(): void {
  try {
    const db = getDb();
    const uncalculatedGames = prepareStmt(`
      SELECT g.id, g.steam_app_id, g.title, g.slug, g.base_price_eur, g.historical_low_eur, g.historical_low_date, g.historical_low_source, g.is_dlc, g.is_free, g.created_at, g.updated_at
      FROM games g
      WHERE g.deal_score_stats_updated_at IS NULL 
         OR g.price_tracking_first_observed_at IS NULL 
         OR g.best_offer_source_count IS NULL
    `).all() as any[];

    if (uncalculatedGames.length === 0) return;

    const updateStmt = prepareStmt(`
      UPDATE games SET
        typical_sale_median_eur = ?,
        typical_sale_q1_eur = ?,
        typical_sale_q3_eur = ?,
        typical_sale_sample_count = ?,
        typical_sale_low_confidence = ?,
        low_90d_eur = ?,
        low_1y_eur = ?,
        atl_is_confirmed = ?,
        atl_is_single_source_low = ?,
        price_tracking_first_observed_at = COALESCE(price_tracking_first_observed_at, ?),
        best_offer_source_count = COALESCE(best_offer_source_count, ?),
        deal_score_stats_updated_at = ?
      WHERE id = ?
    `);

    const histStmt = prepareStmt(`
      SELECT * FROM price_history WHERE game_id = ? ORDER BY recorded_at DESC
    `);

    const bestOfferStmt = prepareStmt(`
      SELECT o.*, m.name as merchant_name, m.code as merchant_code, m.is_official
      FROM offers o
      JOIN merchants m ON o.merchant_id = m.id
      WHERE o.game_id = ? AND o.is_best_deal = 1
      LIMIT 1
    `);

    const sourceCountStmt = prepareStmt(`
      SELECT COUNT(DISTINCT source_code) as cnt FROM source_observations WHERE offer_id = ?
    `);

    const nowIso = new Date().toISOString();
    const backfillTx = db.transaction(() => {
      for (const g of uncalculatedGames) {
        const rawHist = histStmt.all(g.id) as any[];
        const history: PriceHistoryEntry[] = rawHist.map(h => ({
          id: h.id,
          gameId: h.game_id,
          merchantId: h.merchant_id,
          merchantName: '',
          isOfficial: true,
          sourceCode: h.source_code as SourceCode,
          priceEur: Number(h.price_eur),
          discountPercent: Number(h.discount_percent || 0),
          priceEvent: h.price_event || 'NONE',
          dealScore: h.deal_score ? Number(h.deal_score) : undefined,
          recordedAt: h.recorded_at
        }));

        const bestRow = bestOfferStmt.get(g.id) as any;
        let currentBestOffer: Offer | undefined;
        let sourceCount = 1;
        if (bestRow) {
          const sc = (sourceCountStmt.get(bestRow.id) as any)?.cnt;
          if (sc && sc > 0) sourceCount = Number(sc);

          currentBestOffer = {
            id: bestRow.id,
            gameId: bestRow.game_id,
            merchantId: bestRow.merchant_id,
            merchantName: bestRow.merchant_name,
            merchantCode: bestRow.merchant_code,
            isOfficial: Boolean(bestRow.is_official),
            productType: bestRow.product_type,
            regionType: bestRow.region_type,
            regionConfidence: Number(bestRow.region_confidence || 1.0),
            priceEur: Number(bestRow.price_eur),
            discountPercent: Number(bestRow.discount_percent),
            dealUrl: bestRow.deal_url,
            isBestDeal: true,
            isValid: Boolean(bestRow.is_valid),
            priceEvent: bestRow.price_event || 'NONE',
            riskLevel: bestRow.risk_level || 'SAFE',
            riskScore: Number(bestRow.risk_score || 0),
            riskFlags: [],
            evaluationConfidence: Number(bestRow.evaluation_confidence || 1.0),
            isAnomaly: Boolean(bestRow.is_anomaly),
            sources: [],
            sourceAgreementCount: sourceCount,
            fetchedAt: bestRow.fetched_at || nowIso,
            lastObservedAt: bestRow.last_observed_at || nowIso,
            createdAt: bestRow.created_at || nowIso,
            updatedAt: bestRow.updated_at || nowIso
          };
        }

        const basePrice = g.base_price_eur ? Number(g.base_price_eur) : undefined;
        const typicalSale = calculateTypicalSalePrice(basePrice, history);
        const mappedGame: Game = {
          id: g.id,
          steamAppId: Number(g.steam_app_id),
          title: g.title,
          slug: g.slug,
          basePriceEur: basePrice,
          historicalLowEur: g.historical_low_eur ? Number(g.historical_low_eur) : undefined,
          historicalLowDate: g.historical_low_date || undefined,
          historicalLowSource: g.historical_low_source || undefined,
          isDlc: Boolean(g.is_dlc),
          isFree: Boolean(g.is_free),
          hasAnomaly: false,
          offersCount: 1,
          createdAt: g.created_at,
          updatedAt: g.updated_at
        };

        const periodLows = calculatePeriodLows(mappedGame, history, currentBestOffer);
        const atlConfirmed = periodLows.allTimeLow.isConfirmed ? 1 : 0;
        const atlSingleSource = (periodLows.allTimeLow.isConfirmed === false || Boolean(periodLows.low90d.isSingleSourceLow)) ? 1 : 0;

        const firstObserved = rawHist.length > 0
          ? rawHist[rawHist.length - 1].recorded_at
          : (bestRow?.created_at || g.created_at || nowIso);

        updateStmt.run(
          typicalSale.medianPriceEur,
          typicalSale.q1PriceEur ?? null,
          typicalSale.q3PriceEur ?? null,
          typicalSale.sampleCount,
          typicalSale.isLowConfidence ? 1 : 0,
          periodLows.low90d.priceEur,
          periodLows.low1y.priceEur,
          atlConfirmed,
          atlSingleSource,
          firstObserved,
          sourceCount,
          nowIso,
          g.id
        );
      }
    });
    backfillTx();
  } catch {}
}

export function prepareStmt(sql: string): Database.Statement {
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = getDb().prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt;
}

export function clearStmtCache(): void {
  stmtCache.clear();
}

export function closeDb(): void {
  stmtCache.clear();
  if (dbInstance && dbInstance.open) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
  }
}

// ----------------------------------------------------
// Profile Repository
// ----------------------------------------------------
export const profileRepo = {
  list(): Profile[] {
    const rows = prepareStmt(`
      SELECT p.*, COUNT(w.id) as gameCount 
      FROM profiles p 
      LEFT JOIN wishlist_entries w ON p.id = w.profile_id AND w.is_active = 1
      GROUP BY p.id
      ORDER BY p.is_active DESC, p.created_at ASC
    `).all() as any[];

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      steamId: r.steam_id,
      customUrl: r.custom_url || undefined,
      avatarUrl: r.avatar_url || undefined,
      isActive: Boolean(r.is_active),
      gameCount: Number(r.gameCount || 0),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  },

  getActive(): Profile | null {
    const row = prepareStmt(`SELECT * FROM profiles WHERE is_active = 1 LIMIT 1`).get() as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      steamId: row.steam_id,
      customUrl: row.custom_url || undefined,
      avatarUrl: row.avatar_url || undefined,
      isActive: true,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  getById(id: string): Profile | null {
    const row = prepareStmt(`SELECT * FROM profiles WHERE id = ?`).get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      steamId: row.steam_id,
      customUrl: row.custom_url || undefined,
      avatarUrl: row.avatar_url || undefined,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  create(name: string, steamId: string, customUrl?: string, avatarUrl?: string): Profile {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    const count = (prepareStmt(`SELECT COUNT(*) as count FROM profiles`).get() as any).count;
    const isActive = count === 0 ? 1 : 0;

    prepareStmt(`
      INSERT INTO profiles (id, name, steam_id, custom_url, avatar_url, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, steamId, customUrl || null, avatarUrl || null, isActive, now, now);

    return { id, name, steamId, customUrl, avatarUrl, isActive: Boolean(isActive), createdAt: now, updatedAt: now };
  },

  setActive(id: string): void {
    const db = getDb();
    const tx = db.transaction(() => {
      prepareStmt(`UPDATE profiles SET is_active = 0`).run();
      prepareStmt(`UPDATE profiles SET is_active = 1 WHERE id = ?`).run(id);
    });
    tx();
  },

  update(id: string, name: string, steamId: string, customUrl?: string, avatarUrl?: string): void {
    const now = new Date().toISOString();
    prepareStmt(`
      UPDATE profiles 
      SET name = ?, steam_id = ?, custom_url = ?, avatar_url = ?, updated_at = ?
      WHERE id = ?
    `).run(name, steamId, customUrl || null, avatarUrl || null, now, id);
  },

  delete(id: string): void {
    prepareStmt(`DELETE FROM profiles WHERE id = ?`).run(id);
  }
};

export interface WishlistSyncGame {
  id: string;
  steamAppId: number;
  itadId?: string;
  title: string;
  allkeyshopLastCheckedAt?: string;
  allkeyshopCheckIntervalHours?: number;
  allkeyshopUnchangedStreak?: number;
  allkeyshopLastPriceEur?: number;
  targetPriceEur?: number;
}

// ----------------------------------------------------
// Game & Wishlist Repository
// ----------------------------------------------------
export const gameRepo = {
  upsert(game: {
    steamAppId: number;
    title: string;
    slug?: string;
    headerImage?: string;
    capsuleImage?: string;
    releaseDate?: string;
    isDlc?: boolean;
    isFree?: boolean;
    basePriceEur?: number;
    historicalLowEur?: number;
    historicalLowDate?: string;
    historicalLowSource?: string;
    itadId?: string;
  }): Game {
    const now = new Date().toISOString();
    const slug = game.slug || game.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    const existing = prepareStmt(`SELECT * FROM games WHERE steam_app_id = ?`).get(game.steamAppId) as any;
    if (existing) {
      prepareStmt(`
        UPDATE games 
        SET title = COALESCE(?, title),
            header_image = COALESCE(?, header_image),
            capsule_image = COALESCE(?, capsule_image),
            release_date = COALESCE(?, release_date),
            is_dlc = COALESCE(?, is_dlc),
            is_free = COALESCE(?, is_free),
            base_price_eur = COALESCE(?, base_price_eur),
            historical_low_eur = COALESCE(?, historical_low_eur),
            historical_low_date = COALESCE(?, historical_low_date),
            historical_low_source = COALESCE(?, historical_low_source),
            itad_id = COALESCE(?, itad_id),
            updated_at = ?
        WHERE id = ?
      `).run(
        game.title, 
        game.headerImage || null, 
        game.capsuleImage || null, 
        game.releaseDate || null, 
        game.isDlc !== undefined ? (game.isDlc ? 1 : 0) : null,
        game.isFree !== undefined ? (game.isFree ? 1 : 0) : null,
        game.basePriceEur !== undefined ? game.basePriceEur : null,
        game.historicalLowEur !== undefined ? game.historicalLowEur : null,
        game.historicalLowDate || null,
        game.historicalLowSource || null,
        game.itadId || null,
        now,
        existing.id
      );

      return {
        id: existing.id,
        steamAppId: existing.steam_app_id,
        itadId: existing.itad_id || undefined,
        title: game.title || existing.title,
        slug: existing.slug,
        headerImage: game.headerImage || existing.header_image || undefined,
        capsuleImage: game.capsuleImage || existing.capsule_image || undefined,
        releaseDate: game.releaseDate || existing.release_date || undefined,
        isDlc: game.isDlc !== undefined ? game.isDlc : Boolean(existing.is_dlc),
        isFree: game.isFree !== undefined ? game.isFree : Boolean(existing.is_free),
        basePriceEur: game.basePriceEur !== undefined ? game.basePriceEur : (existing.base_price_eur ? Number(existing.base_price_eur) : undefined),
        historicalLowEur: game.historicalLowEur !== undefined ? game.historicalLowEur : (existing.historical_low_eur ? Number(existing.historical_low_eur) : undefined),
        historicalLowDate: game.historicalLowDate || existing.historical_low_date || undefined,
        historicalLowSource: game.historicalLowSource || existing.historical_low_source || undefined,
        hasAnomaly: false,
        offersCount: 0,
        createdAt: existing.created_at,
        updatedAt: now
      };
    }

    const id = randomUUID();
    prepareStmt(`
      INSERT INTO games (id, steam_app_id, itad_id, title, slug, header_image, capsule_image, release_date, is_dlc, is_free, base_price_eur, historical_low_eur, historical_low_date, historical_low_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      game.steamAppId,
      game.itadId || null,
      game.title,
      slug,
      game.headerImage || null,
      game.capsuleImage || null,
      game.releaseDate || null,
      game.isDlc ? 1 : 0,
      game.isFree ? 1 : 0,
      game.basePriceEur || null,
      game.historicalLowEur || null,
      game.historicalLowDate || null,
      game.historicalLowSource || null,
      now,
      now
    );

    return {
      id,
      steamAppId: game.steamAppId,
      itadId: game.itadId,
      title: game.title,
      slug,
      headerImage: game.headerImage,
      capsuleImage: game.capsuleImage,
      releaseDate: game.releaseDate,
      isDlc: Boolean(game.isDlc),
      isFree: Boolean(game.isFree),
      basePriceEur: game.basePriceEur,
      hasAnomaly: false,
      offersCount: 0,
      createdAt: now,
      updatedAt: now
    };
  },

  getById(id: string): Game | null {
    const r = prepareStmt(`
      SELECT g.*, 
        (SELECT target_price_eur FROM wishlist_entries WHERE game_id = g.id AND is_active = 1 LIMIT 1) as target_price_eur,
        bo.id as best_offer_id,
        bo.price_eur as best_price_eur,
        bo.discount_percent as best_discount_percent,
        bo.product_type as best_product_type,
        bo.region_type as best_region_type,
        bo.deal_url as best_deal_url,
        bo.price_event as best_price_event,
        bo.risk_level as best_risk_level,
        bo.last_observed_at as best_last_observed_at,
        m.name as best_merchant_name,
        m.code as best_merchant_code,
        m.is_official as best_merchant_is_official,
        m.trust_score as best_merchant_trust_score,
        (SELECT COUNT(DISTINCT source_code) FROM source_observations WHERE offer_id = bo.id) as best_source_agreement_count,
        (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1) as offers_count,
        (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_anomaly = 1) as anomaly_count
      FROM games g
      LEFT JOIN offers bo ON bo.game_id = g.id AND bo.is_best_deal = 1
      LEFT JOIN merchants m ON bo.merchant_id = m.id
      WHERE g.id = ?
    `).get(id) as any;

    if (!r) return null;
    return mapGameRow(r);
  },

  setTargetPrice(profileId: string, gameId: string, targetPriceEur: number | null): boolean {
    const info = prepareStmt(`
      UPDATE wishlist_entries 
      SET target_price_eur = ? 
      WHERE profile_id = ? AND game_id = ?
    `).run(targetPriceEur !== null && targetPriceEur !== undefined ? Number(targetPriceEur) : null, profileId, gameId);
    return info.changes > 0;
  },

  getBySteamAppId(steamAppId: number): Game | null {
    const r = prepareStmt(`SELECT id FROM games WHERE steam_app_id = ?`).get(steamAppId) as any;
    if (!r) return null;
    return this.getById(r.id);
  },

  updateMetadata(steamAppId: number, details: {
    title?: string;
    headerImage?: string;
    capsuleImage?: string;
    releaseDate?: string;
    isDlc?: boolean;
    isFree?: boolean;
    basePriceEur?: number;
    itadId?: string;
  }): void {
    const validTitle = details.title && !details.title.startsWith('App ') ? details.title : null;
    const slug = validTitle 
      ? validTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') 
      : null;
    prepareStmt(`
      UPDATE games SET
        title = COALESCE(?, title),
        slug = COALESCE(?, slug),
        header_image = COALESCE(?, header_image),
        capsule_image = COALESCE(?, capsule_image),
        release_date = COALESCE(?, release_date),
        is_dlc = CASE WHEN ? IS NOT NULL THEN ? ELSE is_dlc END,
        is_free = CASE WHEN ? IS NOT NULL THEN ? ELSE is_free END,
        base_price_eur = COALESCE(?, base_price_eur),
        itad_id = COALESCE(?, itad_id),
        updated_at = ?
      WHERE steam_app_id = ?
    `).run(
      validTitle,
      slug,
      details.headerImage || null,
      details.capsuleImage || null,
      details.releaseDate || null,
      details.isDlc !== undefined ? (details.isDlc ? 1 : 0) : null,
      details.isDlc !== undefined ? (details.isDlc ? 1 : 0) : null,
      details.isFree !== undefined ? (details.isFree ? 1 : 0) : null,
      details.isFree !== undefined ? (details.isFree ? 1 : 0) : null,
      details.basePriceEur !== undefined ? details.basePriceEur : null,
      details.itadId || null,
      new Date().toISOString(),
      steamAppId
    );
  },

  updateItadId(steamAppId: number, itadId: string): void {
    prepareStmt(`UPDATE games SET itad_id = ?, updated_at = datetime('now') WHERE steam_app_id = ?`).run(itadId, steamAppId);
  },

  updateHistoricalLow(gameId: string, priceEur: number, date: string, source: string): void {
    prepareStmt(`
      UPDATE games 
      SET historical_low_eur = ?, 
          historical_low_date = ?, 
          historical_low_source = ?,
          updated_at = datetime('now')
      WHERE id = ? AND (historical_low_eur IS NULL OR ? < historical_low_eur)
    `).run(priceEur, date, source, gameId, priceEur);
  },

  updateAllkeyshopCheckState(
    gameId: string,
    lastCheckedAt: string,
    lastPriceEur: number | null,
    intervalHours: number,
    streak: number
  ): void {
    prepareStmt(`
      UPDATE games 
      SET allkeyshop_last_checked_at = ?,
          allkeyshop_last_price_eur = ?,
          allkeyshop_check_interval_hours = ?,
          allkeyshop_unchanged_streak = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(lastCheckedAt, lastPriceEur, intervalHours, streak, gameId);
  },

  getWishlistStatistics(profileId: string): WishlistStatistics {
    const row = prepareStmt(`
      SELECT
        COUNT(DISTINCT CASE WHEN (g.is_free = 0 OR g.is_free IS NULL) THEN w.game_id END) as total_games,
        COUNT(DISTINCT CASE WHEN g.is_free = 1 THEN w.game_id END) as free_games,
        COUNT(DISTINCT CASE WHEN (g.is_free = 0 OR g.is_free IS NULL) AND bo.discount_percent > 0 THEN w.game_id END) as games_on_sale,
        COUNT(DISTINCT CASE WHEN (g.is_free = 0 OR g.is_free IS NULL) AND bo.price_event IN ('NEW_HISTORICAL_LOW', 'AT_HISTORICAL_LOW') THEN w.game_id END) as games_at_historical_low,
        COUNT(DISTINCT CASE WHEN (g.is_free = 0 OR g.is_free IS NULL) AND bo.price_event IN ('MAJOR_DROP', 'EXTREME_DROP') THEN w.game_id END) as major_drops_count,
        COUNT(DISTINCT CASE WHEN (g.is_free = 0 OR g.is_free IS NULL) AND EXISTS (SELECT 1 FROM offers ho WHERE ho.game_id = w.game_id AND ho.risk_level = 'HIGH' AND ho.is_valid = 1) THEN w.game_id END) as games_with_high_risk,
        AVG(CASE WHEN (g.is_free = 0 OR g.is_free IS NULL) AND bo.discount_percent > 0 THEN bo.discount_percent END) as avg_discount
      FROM wishlist_entries w
      JOIN games g ON w.game_id = g.id
      LEFT JOIN offers bo ON bo.game_id = g.id AND bo.is_best_deal = 1
      WHERE w.profile_id = ? AND w.is_active = 1
    `).get(profileId) as any;

    return {
      totalGames: Number(row?.total_games || 0),
      freeGamesCount: Number(row?.free_games || 0),
      gamesOnSale: Number(row?.games_on_sale || 0),
      gamesAtHistoricalLow: Number(row?.games_at_historical_low || 0),
      majorDropsCount: Number(row?.major_drops_count || 0),
      gamesWithHighRiskOffers: Number(row?.games_with_high_risk || 0),
      averageDiscountPercent: Math.round(Number(row?.avg_discount || 0))
    };
  },

  getBestDeals(profileId: string, limit: number = 12): Game[] {
    const rows = prepareStmt(`
      SELECT g.*, 
        w.priority,
        w.date_added_steam,
        w.target_price_eur,
        bo.id as best_offer_id,
        bo.price_eur as best_price_eur,
        bo.discount_percent as best_discount_percent,
        bo.product_type as best_product_type,
        bo.region_type as best_region_type,
        bo.deal_url as best_deal_url,
        bo.price_event as best_price_event,
        bo.risk_level as best_risk_level,
        bo.last_observed_at as best_last_observed_at,
        m.name as best_merchant_name,
        m.code as best_merchant_code,
        m.is_official as best_merchant_is_official,
        m.trust_score as best_merchant_trust_score,
        (SELECT COUNT(DISTINCT source_code) FROM source_observations WHERE offer_id = bo.id) as best_source_agreement_count,
        (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1) as offers_count,
        (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_anomaly = 1) as anomaly_count
      FROM wishlist_entries w
      JOIN games g ON w.game_id = g.id
      JOIN offers bo ON bo.game_id = g.id AND bo.is_best_deal = 1
      JOIN merchants m ON bo.merchant_id = m.id
      WHERE w.profile_id = ? AND w.is_active = 1
        AND (g.is_free = 0 OR g.is_free IS NULL)
        AND bo.is_valid = 1
        AND bo.risk_level != 'HIGH'
        AND bo.is_anomaly = 0
        AND (bo.discount_percent > 0 OR (g.base_price_eur IS NOT NULL AND bo.price_eur < g.base_price_eur))
    `).all(profileId) as any[];

    const games = rows.map(mapGameRow);

    games.sort((a, b) => {
      const scoreA = a.bestDealScore ?? 0;
      const scoreB = b.bestDealScore ?? 0;
      if (scoreB !== scoreA) return scoreB - scoreA;

      const riskRank = (risk?: string) => risk === 'SAFE' ? 1 : risk === 'LOW' ? 2 : 3;
      const rankA = riskRank(a.bestRiskLevel);
      const rankB = riskRank(b.bestRiskLevel);
      if (rankA !== rankB) return rankA - rankB;

      return (a.priority ?? 999999) - (b.priority ?? 999999);
    });

    return games.slice(0, Math.min(limit, 50));
  },

  getWishlistGames(profileId: string, options: WishlistFilterOptions = {}): { games: Game[]; total: number } {
    const params: any[] = [profileId];
    let whereClauses = [`w.profile_id = ?`, `w.is_active = 1`];

    // Free vs Paid filtering
    if (options.isFreeOnly === true) {
      whereClauses.push(`(g.is_free = 1 OR g.base_price_eur = 0)`);
    } else {
      whereClauses.push(`(g.is_free = 0 OR g.is_free IS NULL)`);
    }

    if (options.search && options.search.trim() !== '') {
      whereClauses.push(`g.title LIKE ?`);
      params.push(`%${options.search.trim()}%`);
    }

    if (options.saleOnly) {
      whereClauses.push(`(bo.discount_percent > 0 OR (g.base_price_eur IS NOT NULL AND bo.price_eur < g.base_price_eur))`);
    }

    if (options.minDiscount !== undefined && options.minDiscount > 0) {
      whereClauses.push(`bo.discount_percent >= ?`);
      params.push(options.minDiscount);
    }

    if (options.majorDealsOnly) {
      whereClauses.push(`bo.price_event IN ('MAJOR_DROP', 'EXTREME_DROP')`);
    }

    if (options.allTimeLowOnly || options.historicalLowOnly) {
      whereClauses.push(`bo.price_event IN ('NEW_HISTORICAL_LOW', 'AT_HISTORICAL_LOW')`);
    }

    if (options.trustedOnly) {
      whereClauses.push(`bo.risk_level IN ('SAFE', 'LOW') AND (m.is_official = 1 OR m.trust_score >= 0.8)`);
    }

    if (options.minPrice !== undefined && options.minPrice >= 0) {
      whereClauses.push(`bo.price_eur >= ?`);
      params.push(options.minPrice);
    }

    if (options.maxPrice !== undefined && options.maxPrice > 0) {
      whereClauses.push(`bo.price_eur <= ?`);
      params.push(options.maxPrice);
    }

    if (options.underPrice !== undefined && options.underPrice > 0) {
      whereClauses.push(`bo.price_eur <= ?`);
      params.push(options.underPrice);
    }

    if (options.hasAnomaly) {
      whereClauses.push(`(SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_anomaly = 1) > 0`);
    }

    if (options.merchantType === 'official' || (options.merchantType as any) === 'official_only') {
      whereClauses.push(`m.is_official = 1`);
    } else if (options.merchantType === 'keyshop' || (options.merchantType as any) === 'keyshop_only') {
      whereClauses.push(`m.is_official = 0`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    let orderSql = 'ORDER BY w.priority ASC, g.title ASC';
    if (options.sort === 'price_asc') {
      orderSql = 'ORDER BY CASE WHEN bo.price_eur IS NULL THEN 1 ELSE 0 END, bo.price_eur ASC';
    } else if (options.sort === 'price_desc') {
      orderSql = 'ORDER BY CASE WHEN bo.price_eur IS NULL THEN 1 ELSE 0 END, bo.price_eur DESC';
    } else if (options.sort === 'discount_desc') {
      orderSql = 'ORDER BY CASE WHEN bo.discount_percent IS NULL THEN 1 ELSE 0 END, bo.discount_percent DESC';
    } else if (options.sort === 'title_asc') {
      orderSql = 'ORDER BY g.title ASC';
    } else if (options.sort === 'historical_low') {
      orderSql = 'ORDER BY (bo.price_eur - g.historical_low_eur) ASC';
    }

    const limit = Math.min(options.limit || 50, 500);
    const page = Math.max(options.page || 1, 1);
    const offset = (page - 1) * limit;

    const selectFields = `
      g.*, 
      w.priority,
      w.date_added_steam,
      w.target_price_eur,
      bo.id as best_offer_id,
      bo.price_eur as best_price_eur,
      bo.discount_percent as best_discount_percent,
      bo.product_type as best_product_type,
      bo.region_type as best_region_type,
      bo.deal_url as best_deal_url,
      bo.price_event as best_price_event,
      bo.risk_level as best_risk_level,
      bo.last_observed_at as best_last_observed_at,
      m.name as best_merchant_name,
      m.code as best_merchant_code,
      m.is_official as best_merchant_is_official,
      m.trust_score as best_merchant_trust_score,
      (SELECT COUNT(DISTINCT source_code) FROM source_observations WHERE offer_id = bo.id) as best_source_agreement_count,
      (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1) as offers_count,
      (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_anomaly = 1) as anomaly_count
    `;

    // Always fetch candidates and apply computed filters & sorting in memory for high precision
    const allRowsSql = `
      SELECT ${selectFields}
      FROM wishlist_entries w
      JOIN games g ON w.game_id = g.id
      LEFT JOIN offers bo ON bo.game_id = g.id AND bo.is_best_deal = 1
      LEFT JOIN merchants m ON bo.merchant_id = m.id
      ${whereSql}
    `;
    const allRows = prepareStmt(allRowsSql).all(...params) as any[];
    let allGames = allRows.map(mapGameRow);

    // Apply Computed Filters
    if (options.minDealScore !== undefined && options.minDealScore > 0) {
      allGames = allGames.filter(g => (g.bestDealScore ?? 0) >= options.minDealScore!);
    }
    if (options.minConfidence !== undefined && options.minConfidence > 0) {
      allGames = allGames.filter(g => (g.bestConfidenceScore ?? 0) >= options.minConfidence!);
    }
    if (options.hideAnomalies) {
      allGames = allGames.filter(g => !g.hasAnomaly && g.bestRiskLevel !== 'HIGH');
    }
    if (options.hideProvisional) {
      allGames = allGames.filter(g => !g.bestIsProvisional);
    }
    if (options.buyOnly) {
      allGames = allGames.filter(g => g.actionSignal?.decision === 'STRONG_BUY' || g.actionSignal?.decision === 'BUY');
    }
    if (options.actionDecision && options.actionDecision.length > 0) {
      allGames = allGames.filter(g => g.actionSignal && options.actionDecision!.includes(g.actionSignal.decision));
    }

    // Apply Multi-Strategy Discovery Rankings
    allGames.sort((a, b) => {
      if (options.sort === 'best_value') {
        const valA = a.valueRankingScore ?? 0;
        const valB = b.valueRankingScore ?? 0;
        if (valB !== valA) return valB - valA;
      } else if (options.sort === 'deal_score_desc') {
        const scoreA = a.bestDealScore ?? -1;
        const scoreB = b.bestDealScore ?? -1;
        if (scoreB !== scoreA) return scoreB - scoreA;
      } else if (options.sort === 'confidence_desc') {
        const confA = a.bestConfidenceScore ?? 0;
        const confB = b.bestConfidenceScore ?? 0;
        if (confB !== confA) return confB - confA;
      } else if (options.sort === 'near_atl') {
        const distA = a.bestAtlDistanceEur !== undefined ? a.bestAtlDistanceEur : 9999;
        const distB = b.bestAtlDistanceEur !== undefined ? b.bestAtlDistanceEur : 9999;
        if (distA !== distB) return distA - distB;
      } else if (options.sort === 'biggest_savings') {
        const savA = a.bestSavingVsMedianEur ?? 0;
        const savB = b.bestSavingVsMedianEur ?? 0;
        if (savB !== savA) return savB - savA;
      } else if (options.sort === 'price_drops' || options.sort === 'discount_desc') {
        const discA = a.bestDiscountPercent ?? 0;
        const discB = b.bestDiscountPercent ?? 0;
        if (discB !== discA) return discB - discA;
      } else if (options.sort === 'price_asc') {
        const pA = a.bestPriceEur ?? 999999;
        const pB = b.bestPriceEur ?? 999999;
        if (pA !== pB) return pA - pB;
      } else if (options.sort === 'price_desc') {
        const pA = a.bestPriceEur ?? -1;
        const pB = b.bestPriceEur ?? -1;
        if (pB !== pA) return pB - pA;
      } else if (options.sort === 'title_asc') {
        return a.title.localeCompare(b.title);
      } else if (options.sort === 'historical_low') {
        const distA = a.bestAtlDistanceEur !== undefined ? a.bestAtlDistanceEur : 9999;
        const distB = b.bestAtlDistanceEur !== undefined ? b.bestAtlDistanceEur : 9999;
        if (distA !== distB) return distA - distB;
      }

      // Secondary sort tiebreaker: Steam wishlist priority, then title
      return (a.priority ?? 999999) - (b.priority ?? 999999) || a.title.localeCompare(b.title);
    });

    return {
      games: allGames.slice(offset, offset + limit),
      total: allGames.length
    };
  },

  getPriceIntelligence(gameId: string): PriceIntelligenceResponse | null {
    const game = this.getById(gameId);
    if (!game) return null;

    const offers = offerRepo.getOffersForGame(gameId);
    const history = offerRepo.getPriceHistory(gameId, 500);

    return generatePriceIntelligence({ game, offers, history });
  },

  getAllWishlistGameIds(profileId: string): WishlistSyncGame[] {
    const rows = prepareStmt(`
      SELECT 
        g.id, 
        g.steam_app_id, 
        g.itad_id, 
        g.title,
        g.allkeyshop_last_checked_at,
        g.allkeyshop_check_interval_hours,
        g.allkeyshop_unchanged_streak,
        g.allkeyshop_last_price_eur,
        w.target_price_eur
      FROM wishlist_entries w
      JOIN games g ON w.game_id = g.id
      WHERE w.profile_id = ? AND w.is_active = 1
      ORDER BY w.priority ASC
    `).all(profileId) as any[];

    return rows.map(r => ({
      id: r.id,
      steamAppId: Number(r.steam_app_id),
      itadId: r.itad_id || undefined,
      title: r.title,
      allkeyshopLastCheckedAt: r.allkeyshop_last_checked_at || undefined,
      allkeyshopCheckIntervalHours: r.allkeyshop_check_interval_hours !== null && r.allkeyshop_check_interval_hours !== undefined 
        ? Number(r.allkeyshop_check_interval_hours) 
        : undefined,
      allkeyshopUnchangedStreak: r.allkeyshop_unchanged_streak !== null && r.allkeyshop_unchanged_streak !== undefined 
        ? Number(r.allkeyshop_unchanged_streak) 
        : undefined,
      allkeyshopLastPriceEur: r.allkeyshop_last_price_eur !== null && r.allkeyshop_last_price_eur !== undefined 
        ? Number(r.allkeyshop_last_price_eur) 
        : undefined,
      targetPriceEur: r.target_price_eur !== null && r.target_price_eur !== undefined 
        ? Number(r.target_price_eur) 
        : undefined,
    }));
  },

  getStaleWishlistGameIds(profileId: string, ttlHours: number = 6): WishlistSyncGame[] {
    const rows = prepareStmt(`
      SELECT 
        g.id, 
        g.steam_app_id, 
        g.itad_id, 
        g.title,
        g.allkeyshop_last_checked_at,
        g.allkeyshop_check_interval_hours,
        g.allkeyshop_unchanged_streak,
        g.allkeyshop_last_price_eur,
        w.target_price_eur
      FROM wishlist_entries w
      JOIN games g ON w.game_id = g.id
      LEFT JOIN offers o ON o.game_id = g.id
      WHERE w.profile_id = ? AND w.is_active = 1
      GROUP BY g.id
      HAVING COUNT(o.id) = 0 OR MAX(o.fetched_at) < datetime('now', '-' || ? || ' hours') OR g.title LIKE 'App %'
      ORDER BY w.priority ASC
    `).all(profileId, ttlHours) as any[];

    return rows.map(r => ({
      id: r.id,
      steamAppId: Number(r.steam_app_id),
      itadId: r.itad_id || undefined,
      title: r.title,
      allkeyshopLastCheckedAt: r.allkeyshop_last_checked_at || undefined,
      allkeyshopCheckIntervalHours: r.allkeyshop_check_interval_hours !== null && r.allkeyshop_check_interval_hours !== undefined 
        ? Number(r.allkeyshop_check_interval_hours) 
        : undefined,
      allkeyshopUnchangedStreak: r.allkeyshop_unchanged_streak !== null && r.allkeyshop_unchanged_streak !== undefined 
        ? Number(r.allkeyshop_unchanged_streak) 
        : undefined,
      allkeyshopLastPriceEur: r.allkeyshop_last_price_eur !== null && r.allkeyshop_last_price_eur !== undefined 
        ? Number(r.allkeyshop_last_price_eur) 
        : undefined,
      targetPriceEur: r.target_price_eur !== null && r.target_price_eur !== undefined 
        ? Number(r.target_price_eur) 
        : undefined,
    }));
  },

  syncWishlistEntries(profileId: string, items: { 
    steamAppId: number; 
    title: string; 
    priority: number; 
    dateAdded?: string;
    headerImage?: string;
    capsuleImage?: string;
    releaseDate?: string;
    isDlc?: boolean;
    isFree?: boolean;
    basePriceEur?: number;
  }[]): void {
    const db = getDb();
    const now = new Date().toISOString();

    const stmtDeactivate = prepareStmt(`UPDATE wishlist_entries SET is_active = 0 WHERE profile_id = ?`);
    const stmtFindGame = prepareStmt(`SELECT id, title, slug, header_image, base_price_eur FROM games WHERE steam_app_id = ?`);
    const stmtInsertGame = prepareStmt(`
      INSERT INTO games (id, steam_app_id, itad_id, title, slug, header_image, capsule_image, release_date, is_dlc, is_free, base_price_eur, created_at, updated_at)
      VALUES (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const stmtUpdateGame = prepareStmt(`
      UPDATE games SET
        title = CASE WHEN games.title LIKE 'App %' THEN ? ELSE games.title END,
        slug = CASE WHEN games.title LIKE 'App %' THEN ? ELSE games.slug END,
        header_image = COALESCE(?, games.header_image),
        capsule_image = COALESCE(?, games.capsule_image),
        release_date = COALESCE(?, games.release_date),
        is_dlc = COALESCE(?, games.is_dlc),
        is_free = COALESCE(?, games.is_free),
        base_price_eur = COALESCE(?, games.base_price_eur),
        updated_at = ?
      WHERE id = ?
    `);
    const stmtWishlistEntry = prepareStmt(`
      INSERT INTO wishlist_entries (id, profile_id, game_id, priority, date_added_steam, is_active, last_synced_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(profile_id, game_id) DO UPDATE SET
        priority = excluded.priority,
        date_added_steam = COALESCE(excluded.date_added_steam, wishlist_entries.date_added_steam),
        is_active = 1,
        last_synced_at = excluded.last_synced_at
    `);
    
    const tx = db.transaction(() => {
      stmtDeactivate.run(profileId);

      for (const item of items) {
        const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const existing = stmtFindGame.get(item.steamAppId) as any;
        let gameId: string;

        if (existing) {
          gameId = existing.id;
          if (
            (existing.title.startsWith('App ') && !item.title.startsWith('App ')) ||
            !existing.header_image ||
            (existing.base_price_eur === null && item.basePriceEur !== undefined)
          ) {
            stmtUpdateGame.run(
              item.title,
              slug,
              item.headerImage || null,
              item.capsuleImage || null,
              item.releaseDate || null,
              item.isDlc !== undefined ? (item.isDlc ? 1 : 0) : null,
              item.isFree !== undefined ? (item.isFree ? 1 : 0) : null,
              item.basePriceEur !== undefined ? item.basePriceEur : null,
              now,
              gameId
            );
          }
        } else {
          gameId = randomUUID();
          stmtInsertGame.run(
            gameId,
            item.steamAppId,
            item.title,
            slug,
            item.headerImage || null,
            item.capsuleImage || null,
            item.releaseDate || null,
            item.isDlc ? 1 : 0,
            item.isFree ? 1 : 0,
            item.basePriceEur !== undefined ? item.basePriceEur : null,
            now,
            now
          );
        }

        const entryId = randomUUID();
        stmtWishlistEntry.run(entryId, profileId, gameId, item.priority, item.dateAdded || null, now);
      }
    });

    tx();
  },

  resolveGames(queries: { steamAppIds?: number[]; titles?: string[] }): {
    resolved: Array<{
      query: string;
      gameId: string;
      title: string;
      steamAppId: number;
      confidence: number;
    }>;
    unresolved: string[];
  } {
    const resolved: Array<{
      query: string;
      gameId: string;
      title: string;
      steamAppId: number;
      confidence: number;
    }> = [];
    const unresolved: string[] = [];

    if (Array.isArray(queries.steamAppIds)) {
      for (const appId of queries.steamAppIds) {
        if (!appId || typeof appId !== 'number') continue;
        const g = prepareStmt(`SELECT id, steam_app_id, title FROM games WHERE steam_app_id = ?`).get(appId) as any;
        if (g) {
          resolved.push({
            query: String(appId),
            gameId: g.id,
            title: g.title,
            steamAppId: Number(g.steam_app_id),
            confidence: 1.0
          });
        } else {
          unresolved.push(String(appId));
        }
      }
    }

    if (Array.isArray(queries.titles)) {
      for (const title of queries.titles) {
        if (!title || typeof title !== 'string') continue;
        const exact = prepareStmt(`SELECT id, steam_app_id, title FROM games WHERE LOWER(title) = LOWER(?) LIMIT 1`).get(title.trim()) as any;
        if (exact) {
          resolved.push({
            query: title,
            gameId: exact.id,
            title: exact.title,
            steamAppId: Number(exact.steam_app_id),
            confidence: 1.0
          });
        } else {
          const likeMatch = prepareStmt(`SELECT id, steam_app_id, title FROM games WHERE title LIKE ? LIMIT 1`).get(`%${title.trim()}%`) as any;
          if (likeMatch) {
            resolved.push({
              query: title,
              gameId: likeMatch.id,
              title: likeMatch.title,
              steamAppId: Number(likeMatch.steam_app_id),
              confidence: 0.85
            });
          } else {
            unresolved.push(title);
          }
        }
      }
    }

    return { resolved, unresolved };
  }
};

// ----------------------------------------------------
// Merchant Repository
// ----------------------------------------------------
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

// ----------------------------------------------------
// Offer & Observation Repository
// ----------------------------------------------------
export const offerRepo = {
  upsertOffer(data: {
    gameId: string;
    merchantId: string;
    productType: string;
    regionType: string;
    regionCode?: string;
    regionConfidence?: number;
    priceEur: number;
    originalPriceEur?: number;
    rawPrice?: number;
    rawCurrency?: string;
    rawOriginalPrice?: number;
    discountPercent?: number;
    voucherCode?: string;
    dealUrl: string;
    isValid?: boolean;
    sourceCode: SourceCode;
    rawObservationJson?: string;
  }): Offer {
    const db = getDb();
    const now = new Date().toISOString();
    const discount = data.discountPercent !== undefined ? data.discountPercent : 
      (data.originalPriceEur && data.originalPriceEur > data.priceEur 
        ? Math.round(((data.originalPriceEur - data.priceEur) / data.originalPriceEur) * 100) 
        : 0);

    const tx = db.transaction(() => {
      let offerId: string;
      const existing = prepareStmt(`
        SELECT id, price_eur FROM offers 
        WHERE game_id = ? AND merchant_id = ? AND product_type = ? AND region_type = ?
      `).get(data.gameId, data.merchantId, data.productType, data.regionType) as any;

      // 1. Gather context for 2D pricing engine
      const gameInfo = prepareStmt(`SELECT * FROM games WHERE id = ?`).get(data.gameId) as any;
      const merchantInfo = prepareStmt(`SELECT name, is_official, trust_score FROM merchants WHERE id = ?`).get(data.merchantId) as any;
      
      const otherPricesRows = prepareStmt(`SELECT price_eur FROM offers WHERE game_id = ? AND is_valid = 1 AND merchant_id != ?`).all(data.gameId, data.merchantId) as any[];
      const marketPrices = otherPricesRows.map(p => Number(p.price_eur));

      let sourceCount = 1;
      if (existing) {
        const obsCountRow = prepareStmt(`SELECT COUNT(DISTINCT source_code) as c FROM source_observations WHERE offer_id = ?`).get(existing.id) as any;
        const alreadyHasThisSource = prepareStmt(`SELECT 1 FROM source_observations WHERE offer_id = ? AND source_code = ?`).get(existing.id, data.sourceCode);
        sourceCount = (obsCountRow?.c || 0) + (alreadyHasThisSource ? 0 : 1);
      }

      const lastHistory = prepareStmt(`
        SELECT price_eur, discount_percent FROM price_history 
        WHERE game_id = ? AND merchant_id = ? 
        ORDER BY recorded_at DESC LIMIT 1
      `).get(data.gameId, data.merchantId) as any;

      const evalInput: PriceEvaluationInput = {
        currentPriceEur: data.priceEur,
        originalPriceEur: data.originalPriceEur,
        basePriceEur: gameInfo?.base_price_eur ? Number(gameInfo.base_price_eur) : undefined,
        historicalLowEur: gameInfo?.historical_low_eur ? Number(gameInfo.historical_low_eur) : undefined,
        previousPriceEur: lastHistory?.price_eur ? Number(lastHistory.price_eur) : undefined,
        marketPricesEur: marketPrices,
        sourceAgreementCount: Math.max(1, sourceCount),
        isOfficialMerchant: merchantInfo ? Boolean(merchantInfo.is_official) : true,
        merchantTrustScore: merchantInfo?.trust_score ? Number(merchantInfo.trust_score) : 1.0,
        gameReleaseDate: gameInfo?.release_date || undefined
      };

      const pricingEval = evaluatePriceMovement(evalInput);

      if (existing) {
        offerId = existing.id;
        prepareStmt(`
          UPDATE offers
          SET price_eur = ?,
              original_price_eur = COALESCE(?, original_price_eur),
              raw_price = COALESCE(?, raw_price),
              raw_currency = COALESCE(?, raw_currency),
              raw_original_price = COALESCE(?, raw_original_price),
              discount_percent = ?,
              voucher_code = COALESCE(?, voucher_code),
              deal_url = ?,
              is_valid = ?,
              price_event = ?,
              risk_level = ?,
              risk_score = ?,
              risk_flags = ?,
              evaluation_confidence = ?,
              is_anomaly = ?,
              anomaly_score = ?,
              anomaly_reason = ?,
              region_confidence = ?,
              last_observed_at = ?,
              fetched_at = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          data.priceEur,
          data.originalPriceEur || null,
          data.rawPrice !== undefined ? data.rawPrice : null,
          data.rawCurrency || null,
          data.rawOriginalPrice !== undefined ? data.rawOriginalPrice : null,
          discount,
          data.voucherCode || null,
          data.dealUrl,
          data.isValid !== false ? 1 : 0,
          pricingEval.event,
          pricingEval.riskLevel,
          pricingEval.riskScore,
          JSON.stringify(pricingEval.riskFlags),
          pricingEval.confidence,
          pricingEval.isAnomaly ? 1 : 0,
          pricingEval.riskScore,
          pricingEval.summary,
          data.regionConfidence !== undefined ? data.regionConfidence : 1.0,
          now,
          now,
          now,
          offerId
        );
      } else {
        offerId = randomUUID();
        prepareStmt(`
          INSERT INTO offers (
            id, game_id, merchant_id, product_type, region_type, region_code, region_confidence,
            price_eur, original_price_eur, raw_price, raw_currency, raw_original_price,
            discount_percent, voucher_code, deal_url,
            is_best_deal, is_valid, price_event, risk_level, risk_score, risk_flags, evaluation_confidence,
            is_anomaly, anomaly_score, anomaly_reason, fetched_at, last_observed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          offerId,
          data.gameId,
          data.merchantId,
          data.productType,
          data.regionType,
          data.regionCode || null,
          data.regionConfidence !== undefined ? data.regionConfidence : 1.0,
          data.priceEur,
          data.originalPriceEur || null,
          data.rawPrice !== undefined ? data.rawPrice : null,
          data.rawCurrency || 'EUR',
          data.rawOriginalPrice !== undefined ? data.rawOriginalPrice : null,
          discount,
          data.voucherCode || null,
          data.dealUrl,
          data.isValid !== false ? 1 : 0,
          pricingEval.event,
          pricingEval.riskLevel,
          pricingEval.riskScore,
          JSON.stringify(pricingEval.riskFlags),
          pricingEval.confidence,
          pricingEval.isAnomaly ? 1 : 0,
          pricingEval.riskScore,
          pricingEval.summary,
          now,
          now,
          now,
          now
        );
      }

      // If a verified new historical low occurred, update game record
      if (pricingEval.event === 'NEW_HISTORICAL_LOW') {
        gameRepo.updateHistoricalLow(data.gameId, data.priceEur, now, data.sourceCode);
      }

      // Record / update source observation
      const obsId = randomUUID();
      prepareStmt(`
        INSERT INTO source_observations (id, offer_id, source_code, observed_price_eur, observed_raw_price, observed_currency, observed_at, raw_data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(offer_id, source_code) DO UPDATE SET
          observed_price_eur = excluded.observed_price_eur,
          observed_raw_price = COALESCE(excluded.observed_raw_price, source_observations.observed_raw_price),
          observed_currency = COALESCE(excluded.observed_currency, source_observations.observed_currency),
          observed_at = excluded.observed_at,
          raw_data_json = excluded.raw_data_json
      `).run(
        obsId, 
        offerId, 
        data.sourceCode, 
        data.priceEur, 
        data.rawPrice !== undefined ? data.rawPrice : null,
        data.rawCurrency || 'EUR',
        now, 
        data.rawObservationJson || null
      );

      // Record price history only if price or discount actually changed (Idempotent tracking)
      const hasPriceChanged = !lastHistory || 
        Math.abs(Number(lastHistory.price_eur) - data.priceEur) >= 0.005 || 
        Number(lastHistory.discount_percent || 0) !== discount;

      if (hasPriceChanged) {
        // Fetch raw history to compute typical sale price and period lows
        const rawHistory = prepareStmt(`
          SELECT * FROM price_history WHERE game_id = ? ORDER BY recorded_at DESC
        `).all(data.gameId) as any[];

        const history: PriceHistoryEntry[] = rawHistory.map(h => ({
          id: h.id,
          gameId: h.game_id,
          merchantId: h.merchant_id,
          merchantName: '',
          merchantCode: '',
          isOfficial: true,
          sourceCode: h.source_code as SourceCode,
          priceEur: Number(h.price_eur),
          discountPercent: Number(h.discount_percent || 0),
          priceEvent: h.price_event || 'NONE',
          dealScore: h.deal_score ? Number(h.deal_score) : undefined,
          recordedAt: h.recorded_at
        }));

        const currentObservation: PriceHistoryEntry = {
          id: 'temp',
          gameId: data.gameId,
          merchantId: data.merchantId,
          merchantName: merchantInfo?.name || '',
          isOfficial: Boolean(merchantInfo?.is_official),
          sourceCode: data.sourceCode,
          priceEur: data.priceEur,
          discountPercent: discount,
          priceEvent: pricingEval.event,
          recordedAt: now
        };

        const fullHistory = [currentObservation, ...history];
        const basePrice = gameInfo?.base_price_eur ? Number(gameInfo.base_price_eur) : undefined;
        const typicalSale = calculateTypicalSalePrice(basePrice, fullHistory);

        const mappedGame: Game = {
          id: gameInfo.id,
          steamAppId: Number(gameInfo.steam_app_id),
          title: gameInfo.title,
          slug: gameInfo.slug,
          basePriceEur: basePrice,
          historicalLowEur: gameInfo.historical_low_eur ? Number(gameInfo.historical_low_eur) : undefined,
          historicalLowDate: gameInfo.historical_low_date || undefined,
          historicalLowSource: gameInfo.historical_low_source || undefined,
          isDlc: Boolean(gameInfo.is_dlc),
          isFree: Boolean(gameInfo.is_free),
          hasAnomaly: false,
          offersCount: 1,
          createdAt: gameInfo.created_at,
          updatedAt: gameInfo.updated_at
        };

        const periodLows = calculatePeriodLows(mappedGame, fullHistory, {
          id: offerId,
          gameId: data.gameId,
          merchantId: data.merchantId,
          merchantName: merchantInfo?.name || '',
          merchantCode: merchantInfo?.code || '',
          isOfficial: Boolean(merchantInfo?.is_official),
          productType: (data.productType as any) || 'DIRECT_PURCHASE',
          regionType: (data.regionType as any) || 'GLOBAL',
          regionConfidence: data.regionConfidence ?? 1.0,
          priceEur: data.priceEur,
          discountPercent: discount,
          dealUrl: data.dealUrl,
          isBestDeal: true,
          isValid: true,
          priceEvent: pricingEval.event,
          riskLevel: pricingEval.riskLevel,
          riskScore: pricingEval.riskScore,
          riskFlags: pricingEval.riskFlags,
          evaluationConfidence: pricingEval.confidence,
          isAnomaly: pricingEval.isAnomaly,
          sources: [data.sourceCode],
          sourceAgreementCount: 1,
          fetchedAt: now,
          lastObservedAt: now,
          createdAt: now,
          updatedAt: now
        });

        const atlConfirmed = periodLows.allTimeLow.isConfirmed ? 1 : 0;
        const atlSingleSource = (periodLows.allTimeLow.isConfirmed === false || Boolean(periodLows.low90d.isSingleSourceLow)) ? 1 : 0;

        // Cache the statistical metrics on the games table
        prepareStmt(`
          UPDATE games SET
            typical_sale_median_eur = ?,
            typical_sale_q1_eur = ?,
            typical_sale_q3_eur = ?,
            typical_sale_sample_count = ?,
            typical_sale_low_confidence = ?,
            low_90d_eur = ?,
            low_1y_eur = ?,
            atl_is_confirmed = ?,
            atl_is_single_source_low = ?,
            price_tracking_first_observed_at = COALESCE(price_tracking_first_observed_at, ?),
            best_offer_source_count = ?,
            deal_score_stats_updated_at = ?
          WHERE id = ?
        `).run(
          typicalSale.medianPriceEur,
          typicalSale.q1PriceEur ?? null,
          typicalSale.q3PriceEur ?? null,
          typicalSale.sampleCount,
          typicalSale.isLowConfidence ? 1 : 0,
          periodLows.low90d.priceEur,
          periodLows.low1y.priceEur,
          atlConfirmed,
          atlSingleSource,
          now,
          Math.max(1, sourceCount),
          now,
          data.gameId
        );

        const dealCalc = calculateDealScore({
          priceEur: data.priceEur,
          basePriceEur: basePrice,
          typicalSaleMedianEur: typicalSale.medianPriceEur,
          typicalSaleQ1Eur: typicalSale.q1PriceEur,
          typicalSaleQ3Eur: typicalSale.q3PriceEur,
          isLowSample: typicalSale.isLowConfidence || typicalSale.medianPriceEur === null,
          low90dEur: periodLows.low90d.priceEur,
          low1yEur: periodLows.low1y.priceEur,
          allTimeLowEur: periodLows.allTimeLow.priceEur || (gameInfo?.historical_low_eur ? Number(gameInfo.historical_low_eur) : undefined),
          historicalLowEur: periodLows.allTimeLow.priceEur || (gameInfo?.historical_low_eur ? Number(gameInfo.historical_low_eur) : undefined),
          isConfirmedAtl: periodLows.allTimeLow.isConfirmed,
          isSingleSourceLow: Boolean(periodLows.allTimeLow.isConfirmed === false || periodLows.low90d.isSingleSourceLow),
          isAnomaly: pricingEval.isAnomaly,
          riskLevel: pricingEval.riskLevel
        });

        prepareStmt(`
          INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, discount_percent, price_event, deal_score, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), data.gameId, data.merchantId, data.sourceCode, data.priceEur, discount, pricingEval.event, dealCalc.score, now);
      }

      // Recalculate best deal for this game
      offerRepo.recomputeBestDealForGame(data.gameId);

      // Manage genuine anomalies & HIGH risk detections in the anomalies table (Data Safety audit trail)
      if (pricingEval.isAnomaly || pricingEval.riskLevel === 'HIGH') {
        const anomalyType = (pricingEval.riskFlags && pricingEval.riskFlags[0])
          ? pricingEval.riskFlags[0]
          : 'PRICE_ANOMALY';
        anomalyRepo.record(data.gameId, offerId, anomalyType, pricingEval.riskScore, pricingEval.summary);
      }

      return offerId;
    });

    const offerId = tx();
    return this.getById(offerId)!;
  },

  getById(id: string): Offer | null {
    const r = prepareStmt(`
      SELECT o.*, m.name as merchant_name, m.code as merchant_code, m.is_official, m.trust_score,
             g.base_price_eur, g.historical_low_eur, g.typical_sale_median_eur, g.typical_sale_q1_eur,
             g.typical_sale_q3_eur, g.typical_sale_low_confidence, g.low_90d_eur, g.low_1y_eur,
             g.atl_is_confirmed, g.atl_is_single_source_low
      FROM offers o
      JOIN merchants m ON o.merchant_id = m.id
      LEFT JOIN games g ON o.game_id = g.id
      WHERE o.id = ?
    `).get(id) as any;

    if (!r) return null;

    const sources = prepareStmt(`
      SELECT source_code FROM source_observations WHERE offer_id = ?
    `).all(id) as any[];

    let riskFlags: any[] = [];
    if (r.risk_flags) {
      try { riskFlags = JSON.parse(r.risk_flags); } catch {}
    }

    const isOfficial = Boolean(r.is_official);
    const isConfirmedAtl = r.atl_is_confirmed !== null && r.atl_is_confirmed !== undefined
      ? Boolean(r.atl_is_confirmed)
      : true;
    const isSingleSourceLow = r.atl_is_single_source_low !== null && r.atl_is_single_source_low !== undefined
      ? Boolean(r.atl_is_single_source_low)
      : false;

    const dealCalc = calculateDealScore({
      priceEur: Number(r.price_eur),
      basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
      typicalSaleMedianEur: r.typical_sale_median_eur !== null && r.typical_sale_median_eur !== undefined ? Number(r.typical_sale_median_eur) : null,
      typicalSaleQ1Eur: r.typical_sale_q1_eur !== null && r.typical_sale_q1_eur !== undefined ? Number(r.typical_sale_q1_eur) : undefined,
      typicalSaleQ3Eur: r.typical_sale_q3_eur !== null && r.typical_sale_q3_eur !== undefined ? Number(r.typical_sale_q3_eur) : undefined,
      isLowSample: Boolean(r.typical_sale_low_confidence || r.typical_sale_median_eur === null || r.typical_sale_median_eur === undefined),
      low90dEur: r.low_90d_eur !== null && r.low_90d_eur !== undefined ? Number(r.low_90d_eur) : null,
      low1yEur: r.low_1y_eur !== null && r.low_1y_eur !== undefined ? Number(r.low_1y_eur) : null,
      allTimeLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
      historicalLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
      isConfirmedAtl,
      isSingleSourceLow,
      isAnomaly: Boolean(r.is_anomaly),
      riskLevel: r.risk_level || 'SAFE'
    });

    return {
      id: r.id,
      gameId: r.game_id,
      merchantId: r.merchant_id,
      merchantName: r.merchant_name,
      merchantCode: r.merchant_code,
      isOfficial,
      productType: r.product_type,
      regionType: r.region_type,
      regionCode: r.region_code || undefined,
      regionConfidence: Number(r.region_confidence),
      priceEur: Number(r.price_eur),
      originalPriceEur: r.original_price_eur ? Number(r.original_price_eur) : undefined,
      rawPrice: r.raw_price !== null && r.raw_price !== undefined ? Number(r.raw_price) : undefined,
      rawCurrency: r.raw_currency || undefined,
      rawOriginalPrice: r.raw_original_price !== null && r.raw_original_price !== undefined ? Number(r.raw_original_price) : undefined,
      discountPercent: Number(r.discount_percent),
      voucherCode: r.voucher_code || undefined,
      dealUrl: r.deal_url,
      isBestDeal: Boolean(r.is_best_deal),
      isValid: Boolean(r.is_valid),
      priceEvent: r.price_event || 'NONE',
      riskLevel: r.risk_level || 'SAFE',
      riskScore: Number(r.risk_score || 0),
      riskFlags,
      evaluationConfidence: Number(r.evaluation_confidence || 1.0),
      isAnomaly: Boolean(r.is_anomaly),
      anomalyReason: r.anomaly_reason || undefined,
      dealScore: dealCalc.score,
      dealTier: dealCalc.tier,
      confidenceScore: dealCalc.confidenceScore,
      confidenceTier: dealCalc.confidenceTier,
      isProvisional: dealCalc.isProvisional,
      sources: sources.map(s => s.source_code as SourceCode),
      sourceAgreementCount: sources.length,
      fetchedAt: r.fetched_at,
      lastObservedAt: r.last_observed_at || r.fetched_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  },

  getOffersForGame(gameId: string): Offer[] {
    const rows = prepareStmt(`
      SELECT o.*, m.name as merchant_name, m.code as merchant_code, m.is_official, m.trust_score,
             g.base_price_eur, g.historical_low_eur, g.typical_sale_median_eur, g.typical_sale_q1_eur,
             g.typical_sale_q3_eur, g.typical_sale_low_confidence, g.low_90d_eur, g.low_1y_eur,
             g.atl_is_confirmed, g.atl_is_single_source_low
      FROM offers o
      JOIN merchants m ON o.merchant_id = m.id
      LEFT JOIN games g ON o.game_id = g.id
      WHERE o.game_id = ?
      ORDER BY o.is_valid DESC, o.price_eur ASC
    `).all(gameId) as any[];

    return rows.map(r => {
      const sources = prepareStmt(`
        SELECT source_code FROM source_observations WHERE offer_id = ?
      `).all(r.id) as any[];

      let riskFlags: any[] = [];
      if (r.risk_flags) {
        try { riskFlags = JSON.parse(r.risk_flags); } catch {}
      }

      const isOfficial = Boolean(r.is_official);
      const isConfirmedAtl = r.atl_is_confirmed !== null && r.atl_is_confirmed !== undefined
        ? Boolean(r.atl_is_confirmed)
        : true;
      const isSingleSourceLow = r.atl_is_single_source_low !== null && r.atl_is_single_source_low !== undefined
        ? Boolean(r.atl_is_single_source_low)
        : false;

      const dealCalc = calculateDealScore({
        priceEur: Number(r.price_eur),
        basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
        typicalSaleMedianEur: r.typical_sale_median_eur !== null && r.typical_sale_median_eur !== undefined ? Number(r.typical_sale_median_eur) : null,
        typicalSaleQ1Eur: r.typical_sale_q1_eur !== null && r.typical_sale_q1_eur !== undefined ? Number(r.typical_sale_q1_eur) : undefined,
        typicalSaleQ3Eur: r.typical_sale_q3_eur !== null && r.typical_sale_q3_eur !== undefined ? Number(r.typical_sale_q3_eur) : undefined,
        isLowSample: Boolean(r.typical_sale_low_confidence || r.typical_sale_median_eur === null || r.typical_sale_median_eur === undefined),
        low90dEur: r.low_90d_eur !== null && r.low_90d_eur !== undefined ? Number(r.low_90d_eur) : null,
        low1yEur: r.low_1y_eur !== null && r.low_1y_eur !== undefined ? Number(r.low_1y_eur) : null,
        allTimeLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
        historicalLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
        isConfirmedAtl,
        isSingleSourceLow,
        isAnomaly: Boolean(r.is_anomaly),
        riskLevel: r.risk_level || 'SAFE'
      });

      return {
        id: r.id,
        gameId: r.game_id,
        merchantId: r.merchant_id,
        merchantName: r.merchant_name,
        merchantCode: r.merchant_code,
        isOfficial,
        productType: r.product_type,
        regionType: r.region_type,
        regionCode: r.region_code || undefined,
        regionConfidence: Number(r.region_confidence),
        priceEur: Number(r.price_eur),
        originalPriceEur: r.original_price_eur ? Number(r.original_price_eur) : undefined,
        rawPrice: r.raw_price !== null && r.raw_price !== undefined ? Number(r.raw_price) : undefined,
        rawCurrency: r.raw_currency || undefined,
        rawOriginalPrice: r.raw_original_price !== null && r.raw_original_price !== undefined ? Number(r.raw_original_price) : undefined,
        discountPercent: Number(r.discount_percent),
        voucherCode: r.voucher_code || undefined,
        dealUrl: r.deal_url,
        isBestDeal: Boolean(r.is_best_deal),
        isValid: Boolean(r.is_valid),
        priceEvent: r.price_event || 'NONE',
        riskLevel: r.risk_level || 'SAFE',
        riskScore: Number(r.risk_score || 0),
        riskFlags,
        evaluationConfidence: Number(r.evaluation_confidence || 1.0),
        isAnomaly: Boolean(r.is_anomaly),
        anomalyReason: r.anomaly_reason || undefined,
        dealScore: dealCalc.score,
        dealTier: dealCalc.tier,
        sources: sources.map(s => s.source_code as SourceCode),
        sourceAgreementCount: sources.length,
        fetchedAt: r.fetched_at,
        lastObservedAt: r.last_observed_at || r.fetched_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      };
    });
  },

  recomputeBestDealForGame(gameId: string): void {
    prepareStmt(`UPDATE offers SET is_best_deal = 0 WHERE game_id = ?`).run(gameId);

    const best = prepareStmt(`
      SELECT id FROM offers 
      WHERE game_id = ? AND is_valid = 1 
      ORDER BY 
        CASE WHEN is_anomaly = 1 OR risk_level = 'HIGH' THEN 1 ELSE 0 END ASC,
        price_eur ASC 
      LIMIT 1
    `).get(gameId) as any;

    if (best) {
      prepareStmt(`UPDATE offers SET is_best_deal = 1 WHERE id = ?`).run(best.id);
    }
  },

  recomputeAllBestDeals(): void {
    getDb().exec(BEST_DEAL_RECOMPUTE_ALL_SQL);
  },

  getPriceHistory(gameId: string, limit: number = 100): PriceHistoryEntry[] {
    const rows = prepareStmt(`
      SELECT ph.*, m.name as merchant_name, m.is_official
      FROM price_history ph
      JOIN merchants m ON ph.merchant_id = m.id
      WHERE ph.game_id = ?
      ORDER BY ph.recorded_at DESC
      LIMIT ?
    `).all(gameId, limit) as any[];

    return rows.map(r => ({
      id: r.id,
      gameId: r.game_id,
      merchantId: r.merchant_id,
      merchantName: r.merchant_name,
      isOfficial: Boolean(r.is_official),
      sourceCode: r.source_code as SourceCode,
      priceEur: Number(r.price_eur),
      discountPercent: r.discount_percent ? Number(r.discount_percent) : undefined,
      priceEvent: r.price_event || undefined,
      dealScore: r.deal_score !== null && r.deal_score !== undefined ? Number(r.deal_score) : undefined,
      recordedAt: r.recorded_at
    }));
  },

  getOffersCsvExportData(profileId: string): Array<{
    game_title: string;
    merchant_name: string;
    merchant_is_official: number;
    price_eur: number;
    msrp_eur: number | null;
    typical_sale_median_eur: number | null;
    atl_eur: number | null;
    atl_is_confirmed: number | null;
    risk_level: string | null;
    risk_score: number | null;
    risk_flags: string | null;
    is_anomaly: number;
    is_best_deal: number;
    last_observed_at: string | null;
  }> {
    return prepareStmt(`
      SELECT
        g.title AS game_title,
        m.name AS merchant_name,
        m.is_official AS merchant_is_official,
        o.price_eur,
        g.base_price_eur AS msrp_eur,
        g.typical_sale_median_eur,
        g.historical_low_eur AS atl_eur,
        g.atl_is_confirmed,
        o.risk_level,
        o.risk_score,
        o.risk_flags,
        o.is_anomaly,
        o.is_best_deal,
        o.last_observed_at
      FROM offers o
      JOIN games g ON o.game_id = g.id
      JOIN merchants m ON o.merchant_id = m.id
      JOIN wishlist_entries w ON w.game_id = g.id
      WHERE w.profile_id = ? AND w.is_active = 1 AND o.is_valid = 1
      ORDER BY g.title, o.price_eur ASC
    `).all(profileId) as any[];
  },

  getBatchOffers(steamAppIds: number[], options?: { onlyOfficial?: boolean; includeAllOffers?: boolean }): {
    results: Record<string, any>;
    fetchedAt: string;
  } {
    const fetchedAt = new Date().toISOString();
    const results: Record<string, any> = {};

    if (!steamAppIds || steamAppIds.length === 0) {
      return { results, fetchedAt };
    }

    for (const appId of steamAppIds) {
      const g = gameRepo.getBySteamAppId(appId);
      if (!g) continue;

      let offers = offerRepo.getOffersForGame(g.id);
      if (options?.onlyOfficial) {
        offers = offers.filter(o => o.isOfficial);
      }

      const bestDeal = offers.find(o => o.isBestDeal) || offers[0] || null;

      results[String(appId)] = {
        gameId: g.id,
        title: g.title,
        msrpEur: g.basePriceEur ?? null,
        historicalLowEur: g.historicalLowEur ?? null,
        historicalLowDate: g.historicalLowDate ?? null,
        bestPriceEur: bestDeal ? bestDeal.priceEur : (g.basePriceEur ?? null),
        bestMerchant: bestDeal ? bestDeal.merchantName : (g.bestMerchantName || null),
        isOfficial: bestDeal ? bestDeal.isOfficial : (g.bestMerchantIsOfficial ?? false),
        voucherCode: bestDeal?.voucherCode || null,
        dealUrl: bestDeal?.dealUrl || null,
        dealScore: bestDeal ? bestDeal.dealScore : g.bestDealScore,
        dealTier: bestDeal ? bestDeal.dealTier : g.bestDealTier,
        riskLevel: bestDeal ? bestDeal.riskLevel : (g.bestRiskLevel || 'SAFE'),
        riskFlags: bestDeal ? bestDeal.riskFlags : [],
        actionSignal: g.actionSignal || null,
        ...(options?.includeAllOffers ? { offers } : {})
      };
    }

    return { results, fetchedAt };
  }
};

// ----------------------------------------------------
// Source & Diagnostics Repository
// ----------------------------------------------------
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
      lastSuccessAt: r.last_success_at || undefined,
      lastError: r.last_error || undefined,
      cooldownUntil: r.cooldown_until || undefined
    };
  },

  updateCircuitState(code: SourceCode, state: CircuitState, cooldownUntil?: string): void {
    prepareStmt(`
      UPDATE sources 
      SET state = ?, cooldown_until = ?, updated_at = datetime('now') 
      WHERE code = ?
    `).run(state, cooldownUntil || null, code);
  },

  incrementCounters(code: SourceCode, status: 'success' | 'failure' | 'ratelimit', errorMessage?: string): void {
    const now = new Date().toISOString();
    if (status === 'success') {
      prepareStmt(`
        UPDATE sources 
        SET request_count = request_count + 1, 
            success_count = success_count + 1, 
            last_success_at = ?,
            updated_at = ?
        WHERE code = ?
      `).run(now, now, code);
    } else if (status === 'ratelimit') {
      prepareStmt(`
        UPDATE sources 
        SET request_count = request_count + 1, 
            rate_limit_count = rate_limit_count + 1,
            last_error = ?,
            updated_at = ?
        WHERE code = ?
      `).run(errorMessage || 'Rate limit encountered (429)', now, code);
    } else {
      prepareStmt(`
        UPDATE sources 
        SET request_count = request_count + 1, 
            failure_count = failure_count + 1,
            last_error = ?,
            updated_at = ?
        WHERE code = ?
      `).run(errorMessage || 'Request failed', now, code);
    }
  },

  toggle(code: SourceCode, isEnabled: boolean): void {
    prepareStmt(`UPDATE sources SET is_enabled = ?, updated_at = datetime('now') WHERE code = ?`).run(isEnabled ? 1 : 0, code);
  }
};

// ----------------------------------------------------
// Anomaly Repository
// ----------------------------------------------------
export const anomalyRepo = {
  record(gameId: string, offerId: string, type: Anomaly['anomalyType'], score: number, reason: string): void {
    const now = new Date().toISOString();
    const existing = prepareStmt(`
      SELECT id FROM anomalies 
      WHERE game_id = ? AND offer_id = ? AND is_dismissed = 0
    `).get(gameId, offerId) as any;

    if (existing) {
      prepareStmt(`
        UPDATE anomalies 
        SET score = ?, reason = ?, anomaly_type = ?, detected_at = ? 
        WHERE id = ?
      `).run(score, reason, type, now, existing.id);
    } else {
      const id = randomUUID();
      prepareStmt(`
        INSERT INTO anomalies (id, game_id, offer_id, anomaly_type, score, reason, detected_at, is_dismissed)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).run(id, gameId, offerId, type, score, reason, now);
    }
  },

  list(onlyActive: boolean = true): Anomaly[] {
    const sql = onlyActive 
      ? `SELECT a.*, o.price_eur, o.original_price_eur, o.deal_url, g.title as game_title, g.steam_app_id, m.name as merchant_name, m.default_url as merchant_default_url 
         FROM anomalies a 
         LEFT JOIN games g ON a.game_id = g.id
         LEFT JOIN offers o ON a.offer_id = o.id
         LEFT JOIN merchants m ON o.merchant_id = m.id
         WHERE a.is_dismissed = 0
         ORDER BY a.detected_at DESC`
      : `SELECT a.*, o.price_eur, o.original_price_eur, o.deal_url, g.title as game_title, g.steam_app_id, m.name as merchant_name, m.default_url as merchant_default_url 
         FROM anomalies a 
         LEFT JOIN games g ON a.game_id = g.id
         LEFT JOIN offers o ON a.offer_id = o.id
         LEFT JOIN merchants m ON o.merchant_id = m.id
         ORDER BY a.detected_at DESC`;

    const rows = prepareStmt(sql).all() as any[];
    return rows.map(r => {
      let targetUrl = r.deal_url || r.merchant_default_url;
      if (!targetUrl && r.steam_app_id) {
        targetUrl = `https://store.steampowered.com/app/${r.steam_app_id}/`;
      }
      return {
        id: r.id,
        gameId: r.game_id,
        gameTitle: r.game_title || 'Unknown Game',
        steamAppId: r.steam_app_id ? Number(r.steam_app_id) : undefined,
        offerId: r.offer_id,
        merchantName: r.merchant_name || 'Unknown Store',
        priceEur: r.price_eur !== null && r.price_eur !== undefined ? Number(r.price_eur) : undefined,
        originalPriceEur: r.original_price_eur !== null && r.original_price_eur !== undefined ? Number(r.original_price_eur) : undefined,
        dealUrl: targetUrl || undefined,
        anomalyType: r.anomaly_type || 'PRICE_GLITCH',
        score: Number(r.score || 0),
        reason: r.reason || 'Flagged price anomaly',
        detectedAt: r.detected_at || new Date().toISOString(),
        isDismissed: Boolean(r.is_dismissed)
      };
    });
  },

  dismiss(id: string): void {
    prepareStmt(`UPDATE anomalies SET is_dismissed = 1 WHERE id = ?`).run(id);
  },

  dismissAll(): void {
    prepareStmt(`UPDATE anomalies SET is_dismissed = 1 WHERE is_dismissed = 0`).run();
  }
};

// ----------------------------------------------------
// Settings Repository
// ----------------------------------------------------
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

// ----------------------------------------------------
// Notifications Repository
// ----------------------------------------------------
export const notificationsRepo = {
  hasRecentNotification(gameId: string, minHours: number = 24, currentPriceEur?: number): boolean {
    const cutoff = new Date(Date.now() - minHours * 3600 * 1000).toISOString();
    const row = prepareStmt(`
      SELECT price_eur, sent_at
      FROM notifications_log
      WHERE game_id = ? AND sent_at >= ?
      ORDER BY sent_at DESC
      LIMIT 1
    `).get(gameId, cutoff) as any;

    if (!row) return false;

    // If a new price drop occurred that is noticeably lower than what was notified, allow re-notification!
    if (currentPriceEur !== undefined && currentPriceEur < Number(row.price_eur) - 0.05) {
      return false;
    }

    return true;
  },

  logNotification(gameId: string, priceEur: number, dealScore: number, channel: string = 'discord'): void {
    prepareStmt(`
      INSERT INTO notifications_log (id, game_id, channel, price_eur, deal_score, sent_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), gameId, channel, priceEur, dealScore, new Date().toISOString());
  }
};

// ----------------------------------------------------
// Helper Mappers
// ----------------------------------------------------
function mapGameRow(r: any): Game {
  let bestDealScore: number | undefined;
  let bestDealTier: DealScoreTier | undefined;
  let bestConfidenceScore: number | undefined;
  let bestConfidenceTier: ConfidenceTier | undefined;
  let bestIsProvisional: boolean | undefined;
  let bestZScore: number | undefined;
  let bestEffectiveSigma: number | undefined;
  let bestSavingVsMedianEur: number | undefined;
  let bestAtlDistanceEur: number | undefined;
  let valueRankingScore: number | undefined;

  if (r.best_price_eur !== null && r.best_price_eur !== undefined) {
    const isOfficial = r.best_merchant_is_official !== undefined && r.best_merchant_is_official !== null
      ? Boolean(r.best_merchant_is_official)
      : true;

    const isConfirmedAtl = r.atl_is_confirmed !== null && r.atl_is_confirmed !== undefined
      ? Boolean(r.atl_is_confirmed)
      : true;
    const isSingleSourceLow = r.atl_is_single_source_low !== null && r.atl_is_single_source_low !== undefined
      ? Boolean(r.atl_is_single_source_low)
      : false;

    const dealResult = calculateDealScore({
      priceEur: Number(r.best_price_eur),
      basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
      typicalSaleMedianEur: r.typical_sale_median_eur !== null && r.typical_sale_median_eur !== undefined ? Number(r.typical_sale_median_eur) : null,
      typicalSaleQ1Eur: r.typical_sale_q1_eur !== null && r.typical_sale_q1_eur !== undefined ? Number(r.typical_sale_q1_eur) : undefined,
      typicalSaleQ3Eur: r.typical_sale_q3_eur !== null && r.typical_sale_q3_eur !== undefined ? Number(r.typical_sale_q3_eur) : undefined,
      isLowSample: Boolean(r.typical_sale_low_confidence || r.typical_sale_median_eur === null || r.typical_sale_median_eur === undefined),
      low90dEur: r.low_90d_eur !== null && r.low_90d_eur !== undefined ? Number(r.low_90d_eur) : null,
      low1yEur: r.low_1y_eur !== null && r.low_1y_eur !== undefined ? Number(r.low_1y_eur) : null,
      allTimeLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
      historicalLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
      isConfirmedAtl,
      isSingleSourceLow,
      sampleCount: r.typical_sale_sample_count !== null && r.typical_sale_sample_count !== undefined ? Number(r.typical_sale_sample_count) : undefined,
      firstObservedAt: r.price_tracking_first_observed_at || undefined,
      lastObservedAt: r.best_last_observed_at || r.last_observed_at || undefined,
      sourceCount: r.best_offer_source_count !== null && r.best_offer_source_count !== undefined
        ? Number(r.best_offer_source_count)
        : undefined,
      isOfficialSource: isOfficial
    });

    bestDealScore = dealResult.score;
    bestDealTier = dealResult.tier;
    bestConfidenceScore = dealResult.confidenceScore;
    bestConfidenceTier = dealResult.confidenceTier;
    bestIsProvisional = dealResult.isProvisional;
    bestZScore = dealResult.zScore;
    bestEffectiveSigma = dealResult.explanation?.effectiveSigma;
    bestSavingVsMedianEur = dealResult.explanation?.medianSavingEur;
    bestAtlDistanceEur = dealResult.explanation?.atlDistanceEur;
    // Value Ranking Score for discovery: monotonic combination of deal score and confidence
    valueRankingScore = Number((dealResult.score * (0.65 + 0.35 * (dealResult.confidenceScore / 100))).toFixed(1));
  }

  let actionSignal: ActionSignal | undefined = undefined;
  if (r.best_price_eur !== null && r.best_price_eur !== undefined && bestDealScore !== undefined) {
    actionSignal = generateActionSignal({
      dealScore: bestDealScore,
      confidenceScore: bestConfidenceScore ?? 50,
      isProvisional: Boolean(bestIsProvisional),
      isAnomaly: Boolean(r.anomaly_count && Number(r.anomaly_count) > 0),
      currentPriceEur: Number(r.best_price_eur),
      basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
      typicalSaleMedianEur: r.typical_sale_median_eur !== null && r.typical_sale_median_eur !== undefined ? Number(r.typical_sale_median_eur) : undefined,
      typicalSaleQ1Eur: r.typical_sale_q1_eur !== null && r.typical_sale_q1_eur !== undefined ? Number(r.typical_sale_q1_eur) : undefined,
      typicalSaleQ3Eur: r.typical_sale_q3_eur !== null && r.typical_sale_q3_eur !== undefined ? Number(r.typical_sale_q3_eur) : undefined,
      typicalSaleSampleCount: r.typical_sale_sample_count !== null && r.typical_sale_sample_count !== undefined ? Number(r.typical_sale_sample_count) : undefined,
      historicalLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
      low90dEur: r.low_90d_eur !== null && r.low_90d_eur !== undefined ? Number(r.low_90d_eur) : undefined
    });
  }

  return {
    id: r.id,
    steamAppId: Number(r.steam_app_id),
    itadId: r.itad_id || undefined,
    title: r.title,
    slug: r.slug,
    headerImage: r.header_image || undefined,
    capsuleImage: r.capsule_image || undefined,
    releaseDate: r.release_date || undefined,
    isDlc: Boolean(r.is_dlc),
    isFree: Boolean(r.is_free),
    basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
    historicalLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
    historicalLowDate: r.historical_low_date || undefined,
    historicalLowSource: r.historical_low_source || undefined,
    typicalSaleMedianEur: r.typical_sale_median_eur !== null && r.typical_sale_median_eur !== undefined ? Number(r.typical_sale_median_eur) : undefined,
    typicalSaleQ1Eur: r.typical_sale_q1_eur !== null && r.typical_sale_q1_eur !== undefined ? Number(r.typical_sale_q1_eur) : undefined,
    typicalSaleQ3Eur: r.typical_sale_q3_eur !== null && r.typical_sale_q3_eur !== undefined ? Number(r.typical_sale_q3_eur) : undefined,
    typicalSaleSampleCount: r.typical_sale_sample_count !== null && r.typical_sale_sample_count !== undefined ? Number(r.typical_sale_sample_count) : undefined,
    low90dEur: r.low_90d_eur !== null && r.low_90d_eur !== undefined ? Number(r.low_90d_eur) : undefined,
    low1yEur: r.low_1y_eur !== null && r.low_1y_eur !== undefined ? Number(r.low_1y_eur) : undefined,
    atlIsConfirmed: r.atl_is_confirmed !== null && r.atl_is_confirmed !== undefined ? Boolean(r.atl_is_confirmed) : undefined,
    atlIsSingleSourceLow: r.atl_is_single_source_low !== null && r.atl_is_single_source_low !== undefined ? Boolean(r.atl_is_single_source_low) : undefined,
    bestPriceEur: r.best_price_eur !== null && r.best_price_eur !== undefined ? Number(r.best_price_eur) : undefined,
    bestMerchantName: r.best_merchant_name || undefined,
    bestMerchantCode: r.best_merchant_code || undefined,
    bestMerchantIsOfficial: r.best_merchant_is_official !== undefined && r.best_merchant_is_official !== null ? Boolean(r.best_merchant_is_official) : undefined,
    bestProductType: r.best_product_type || undefined,
    bestRegionType: r.best_region_type || undefined,
    bestDiscountPercent: r.best_discount_percent !== null && r.best_discount_percent !== undefined ? Number(r.best_discount_percent) : undefined,
    bestDealUrl: r.best_deal_url || undefined,
    bestOfferId: r.best_offer_id || undefined,
    bestPriceEvent: r.best_price_event || undefined,
    bestRiskLevel: r.best_risk_level || undefined,
    bestDealScore,
    bestDealTier,
    bestConfidenceScore,
    bestConfidenceTier,
    bestIsProvisional,
    bestZScore,
    bestEffectiveSigma,
    bestSavingVsMedianEur,
    bestAtlDistanceEur,
    valueRankingScore,
    actionSignal,
    hasAnomaly: Number(r.anomaly_count || 0) > 0,
    anomalyCount: Number(r.anomaly_count || 0),
    offersCount: Number(r.offers_count || 0),
    priority: r.priority !== undefined ? Number(r.priority) : undefined,
    dateAddedSteam: r.date_added_steam || undefined,
    targetPriceEur: r.target_price_eur !== null && r.target_price_eur !== undefined ? Number(r.target_price_eur) : undefined,
    allkeyshopLastCheckedAt: r.allkeyshop_last_checked_at || undefined,
    allkeyshopCheckIntervalHours: r.allkeyshop_check_interval_hours !== null && r.allkeyshop_check_interval_hours !== undefined ? Number(r.allkeyshop_check_interval_hours) : undefined,
    allkeyshopUnchangedStreak: r.allkeyshop_unchanged_streak !== null && r.allkeyshop_unchanged_streak !== undefined ? Number(r.allkeyshop_unchanged_streak) : undefined,
    allkeyshopLastPriceEur: r.allkeyshop_last_price_eur !== null && r.allkeyshop_last_price_eur !== undefined ? Number(r.allkeyshop_last_price_eur) : undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
