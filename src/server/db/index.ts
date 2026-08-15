import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { SCHEMA_SQL, SEED_SOURCES_SQL } from './schema.js';
import { evaluatePriceMovement, type PriceEvaluationInput } from '../domain/pricingEngine.js';
import { calculateDealScore } from '../domain/dealScore.js';
import { generatePriceIntelligence } from '../domain/priceIntelligence.js';
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
  PriceIntelligenceResponse
} from '../../shared/types.js';

let dbInstance: Database.Database | null = null;
const stmtCache = new Map<string, Database.Statement>();

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
    try { dbInstance.exec("ALTER TABLE source_observations ADD COLUMN observed_raw_price REAL"); } catch {}
    try { dbInstance.exec("ALTER TABLE source_observations ADD COLUMN observed_currency TEXT DEFAULT 'EUR'"); } catch {}
    try { dbInstance.exec("ALTER TABLE price_history ADD COLUMN price_event TEXT"); } catch {}
    try { dbInstance.exec("ALTER TABLE price_history ADD COLUMN deal_score INTEGER"); } catch {}
    try { dbInstance.exec("CREATE INDEX IF NOT EXISTS idx_offers_risk_level ON offers(risk_level)"); } catch {}
    try { dbInstance.exec("CREATE INDEX IF NOT EXISTS idx_offers_price_event ON offers(price_event)"); } catch {}

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

        -- Clean up fake AllKeyShop / Borderlands mismatched offers
        DELETE FROM source_observations WHERE source_code = 'allkeyshop';
        DELETE FROM offers WHERE id IN (
          SELECT o.id FROM offers o
          JOIN games g ON o.game_id = g.id
          WHERE (LOWER(o.deal_url) LIKE '%borderlands%' AND LOWER(g.title) NOT LIKE '%borderlands%')
             OR (o.merchant_id IN (SELECT id FROM merchants WHERE LOWER(code) IN ('allkeyshop', 'allkeyshopbest', 'kinguin') AND LOWER(g.title) NOT LIKE '%borderlands%'))
        );

        -- Delete any orphaned offers
        DELETE FROM offers WHERE id NOT IN (SELECT DISTINCT offer_id FROM source_observations);

        -- Reset and reassign is_best_deal for all games
        UPDATE offers SET is_best_deal = 0;
        UPDATE offers SET is_best_deal = 1 WHERE id IN (
          SELECT o.id FROM offers o
          INNER JOIN (
            SELECT game_id, MIN(price_eur) as min_price
            FROM offers
            WHERE is_valid = 1 AND (is_anomaly = 0 AND risk_level != 'HIGH')
            GROUP BY game_id
          ) best ON o.game_id = best.game_id AND o.price_eur = best.min_price
        );
      `);
    } catch {}
  }
  return dbInstance;
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
        historicalLowEur: existing.historical_low_eur ? Number(existing.historical_low_eur) : undefined,
        historicalLowDate: existing.historical_low_date || undefined,
        historicalLowSource: existing.historical_low_source || undefined,
        hasAnomaly: false,
        offersCount: 0,
        createdAt: existing.created_at,
        updatedAt: now
      };
    }

    const id = randomUUID();
    prepareStmt(`
      INSERT INTO games (id, steam_app_id, itad_id, title, slug, header_image, capsule_image, release_date, is_dlc, is_free, base_price_eur, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        bo.id as best_offer_id,
        bo.price_eur as best_price_eur,
        bo.discount_percent as best_discount_percent,
        bo.product_type as best_product_type,
        bo.region_type as best_region_type,
        bo.deal_url as best_deal_url,
        bo.price_event as best_price_event,
        bo.risk_level as best_risk_level,
        bo.evaluation_confidence as best_evaluation_confidence,
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

  getBySteamAppId(steamAppId: number): Game | null {
    const r = prepareStmt(`SELECT id FROM games WHERE steam_app_id = ?`).get(steamAppId) as any;
    if (!r) return null;
    return this.getById(r.id);
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
        bo.id as best_offer_id,
        bo.price_eur as best_price_eur,
        bo.discount_percent as best_discount_percent,
        bo.product_type as best_product_type,
        bo.region_type as best_region_type,
        bo.deal_url as best_deal_url,
        bo.price_event as best_price_event,
        bo.risk_level as best_risk_level,
        bo.evaluation_confidence as best_evaluation_confidence,
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
        AND bo.discount_percent > 0
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
      whereClauses.push(`bo.discount_percent > 0`);
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
      bo.id as best_offer_id,
      bo.price_eur as best_price_eur,
      bo.discount_percent as best_discount_percent,
      bo.product_type as best_product_type,
      bo.region_type as best_region_type,
      bo.deal_url as best_deal_url,
      bo.price_event as best_price_event,
      bo.risk_level as best_risk_level,
      bo.evaluation_confidence as best_evaluation_confidence,
      m.name as best_merchant_name,
      m.code as best_merchant_code,
      m.is_official as best_merchant_is_official,
      m.trust_score as best_merchant_trust_score,
      (SELECT COUNT(DISTINCT source_code) FROM source_observations WHERE offer_id = bo.id) as best_source_agreement_count,
      (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1) as offers_count,
      (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_anomaly = 1) as anomaly_count
    `;

    // If sorting by deal_score_desc (computed in TypeScript)
    if (options.sort === 'deal_score_desc') {
      const allRowsSql = `
        SELECT ${selectFields}
        FROM wishlist_entries w
        JOIN games g ON w.game_id = g.id
        LEFT JOIN offers bo ON bo.game_id = g.id AND bo.is_best_deal = 1
        LEFT JOIN merchants m ON bo.merchant_id = m.id
        ${whereSql}
      `;
      const allRows = prepareStmt(allRowsSql).all(...params) as any[];
      const allGames = allRows.map(mapGameRow);

      allGames.sort((a, b) => {
        const scoreA = a.bestDealScore ?? -1;
        const scoreB = b.bestDealScore ?? -1;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return (a.priority ?? 999999) - (b.priority ?? 999999);
      });

      return {
        games: allGames.slice(offset, offset + limit),
        total: allGames.length
      };
    }

    const countSql = `
      SELECT COUNT(*) as total 
      FROM wishlist_entries w
      JOIN games g ON w.game_id = g.id
      LEFT JOIN offers bo ON bo.game_id = g.id AND bo.is_best_deal = 1
      LEFT JOIN merchants m ON bo.merchant_id = m.id
      ${whereSql}
    `;
    const countRow = prepareStmt(countSql).get(...params) as any;

    const selectSql = `
      SELECT ${selectFields}
      FROM wishlist_entries w
      JOIN games g ON w.game_id = g.id
      LEFT JOIN offers bo ON bo.game_id = g.id AND bo.is_best_deal = 1
      LEFT JOIN merchants m ON bo.merchant_id = m.id
      ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?
    `;
    const rows = prepareStmt(selectSql).all(...params, limit, offset) as any[];

    return {
      games: rows.map(mapGameRow),
      total: Number(countRow?.total || 0)
    };
  },

  getPriceIntelligence(gameId: string): PriceIntelligenceResponse | null {
    const game = this.getById(gameId);
    if (!game) return null;

    const offers = offerRepo.getOffersForGame(gameId);
    const history = offerRepo.getPriceHistory(gameId, 500);

    return generatePriceIntelligence({ game, offers, history });
  },

  getAllWishlistGameIds(profileId: string): { id: string; steamAppId: number; itadId?: string; title: string }[] {
    const rows = prepareStmt(`
      SELECT g.id, g.steam_app_id, g.itad_id, g.title
      FROM wishlist_entries w
      JOIN games g ON w.game_id = g.id
      WHERE w.profile_id = ? AND w.is_active = 1
      ORDER BY w.priority ASC
    `).all(profileId) as any[];

    return rows.map(r => ({
      id: r.id,
      steamAppId: Number(r.steam_app_id),
      itadId: r.itad_id || undefined,
      title: r.title
    }));
  },

  getStaleWishlistGameIds(profileId: string, ttlHours: number = 6): { id: string; steamAppId: number; itadId?: string; title: string }[] {
    const rows = prepareStmt(`
      SELECT g.id, g.steam_app_id, g.itad_id, g.title
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
      title: r.title
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
      const gameInfo = prepareStmt(`SELECT base_price_eur, historical_low_eur, release_date FROM games WHERE id = ?`).get(data.gameId) as any;
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

      // Manage genuine anomalies in the anomalies table
      if (pricingEval.isAnomaly) {
        const existingAnomaly = prepareStmt(`SELECT id FROM anomalies WHERE offer_id = ? AND is_dismissed = 0`).get(offerId) as any;
        if (existingAnomaly) {
          prepareStmt(`
            UPDATE anomalies 
            SET score = ?, reason = ?, detected_at = ? 
            WHERE id = ?
          `).run(pricingEval.riskScore, pricingEval.summary, now, existingAnomaly.id);
        } else {
          prepareStmt(`
            INSERT INTO anomalies (id, game_id, offer_id, anomaly_type, score, reason, detected_at, is_dismissed)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
          `).run(randomUUID(), data.gameId, offerId, pricingEval.riskFlags[0] || 'PRICE_ANOMALY', pricingEval.riskScore, pricingEval.summary, now);
        }
      } else {
        prepareStmt(`DELETE FROM anomalies WHERE offer_id = ? AND is_dismissed = 0`).run(offerId);
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
        const dealCalc = calculateDealScore({
          priceEur: data.priceEur,
          basePriceEur: gameInfo?.base_price_eur ? Number(gameInfo.base_price_eur) : undefined,
          originalPriceEur: data.originalPriceEur,
          discountPercent: discount,
          priceEvent: pricingEval.event,
          historicalLowEur: gameInfo?.historical_low_eur ? Number(gameInfo.historical_low_eur) : undefined,
          isOfficialMerchant: Boolean(merchantInfo?.is_official),
          merchantTrustScore: merchantInfo?.trust_score ? Number(merchantInfo.trust_score) : 1.0,
          sourceAgreementCount: 1,
          riskLevel: pricingEval.riskLevel,
          riskScore: pricingEval.riskScore,
          evaluationConfidence: pricingEval.confidence,
          isAnomaly: pricingEval.isAnomaly
        });

        prepareStmt(`
          INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, discount_percent, price_event, deal_score, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), data.gameId, data.merchantId, data.sourceCode, data.priceEur, discount, pricingEval.event, dealCalc.score, now);
      }

      // Recalculate best deal for this game
      offerRepo.recomputeBestDealForGame(data.gameId);

      return offerId;
    });

    const offerId = tx();
    return this.getById(offerId)!;
  },

  getById(id: string): Offer | null {
    const r = prepareStmt(`
      SELECT o.*, m.name as merchant_name, m.code as merchant_code, m.is_official, m.trust_score
      FROM offers o
      JOIN merchants m ON o.merchant_id = m.id
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
    const merchantTrust = r.trust_score !== null && r.trust_score !== undefined ? Number(r.trust_score) : 1.0;
    const dealCalc = calculateDealScore({
      priceEur: Number(r.price_eur),
      originalPriceEur: r.original_price_eur ? Number(r.original_price_eur) : undefined,
      discountPercent: Number(r.discount_percent),
      priceEvent: r.price_event || 'NONE',
      isOfficialMerchant: isOfficial,
      merchantTrustScore: merchantTrust,
      sourceAgreementCount: sources.length,
      riskLevel: r.risk_level || 'SAFE',
      riskScore: Number(r.risk_score || 0),
      evaluationConfidence: Number(r.evaluation_confidence || 1.0),
      isAnomaly: Boolean(r.is_anomaly)
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
  },

  getOffersForGame(gameId: string): Offer[] {
    const rows = prepareStmt(`
      SELECT o.*, m.name as merchant_name, m.code as merchant_code, m.is_official, m.trust_score
      FROM offers o
      JOIN merchants m ON o.merchant_id = m.id
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
      const merchantTrust = r.trust_score !== null && r.trust_score !== undefined ? Number(r.trust_score) : 1.0;
      const dealCalc = calculateDealScore({
        priceEur: Number(r.price_eur),
        originalPriceEur: r.original_price_eur ? Number(r.original_price_eur) : undefined,
        discountPercent: Number(r.discount_percent),
        priceEvent: r.price_event || 'NONE',
        isOfficialMerchant: isOfficial,
        merchantTrustScore: merchantTrust,
        sourceAgreementCount: sources.length,
        riskLevel: r.risk_level || 'SAFE',
        riskScore: Number(r.risk_score || 0),
        evaluationConfidence: Number(r.evaluation_confidence || 1.0),
        isAnomaly: Boolean(r.is_anomaly)
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
    const id = randomUUID();
    const now = new Date().toISOString();
    prepareStmt(`
      INSERT INTO anomalies (id, game_id, offer_id, anomaly_type, score, reason, detected_at, is_dismissed)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(id, gameId, offerId, type, score, reason, now);
  },

  list(onlyActive: boolean = true): Anomaly[] {
    const db = getDb();
    const sql = onlyActive 
      ? `SELECT a.*, o.price_eur, o.original_price_eur, o.deal_url, g.title as game_title, g.steam_app_id, m.name as merchant_name, m.affiliate_url_template 
         FROM anomalies a 
         JOIN games g ON a.game_id = g.id
         JOIN offers o ON a.offer_id = o.id
         JOIN merchants m ON o.merchant_id = m.id
         WHERE a.is_dismissed = 0
         ORDER BY a.detected_at DESC`
      : `SELECT a.*, o.price_eur, o.original_price_eur, o.deal_url, g.title as game_title, g.steam_app_id, m.name as merchant_name, m.affiliate_url_template 
         FROM anomalies a 
         JOIN games g ON a.game_id = g.id
         JOIN offers o ON a.offer_id = o.id
         JOIN merchants m ON o.merchant_id = m.id
         ORDER BY a.detected_at DESC`;

    const rows = prepareStmt(sql).all() as any[];
    return rows.map(r => {
      let targetUrl = r.deal_url || r.affiliate_url_template;
      if (!targetUrl && r.steam_app_id) {
        targetUrl = `https://store.steampowered.com/app/${r.steam_app_id}/`;
      }
      return {
        id: r.id,
        gameId: r.game_id,
        gameTitle: r.game_title,
        steamAppId: r.steam_app_id ? Number(r.steam_app_id) : undefined,
        offerId: r.offer_id,
        merchantName: r.merchant_name,
        priceEur: r.price_eur ? Number(r.price_eur) : undefined,
        originalPriceEur: r.original_price_eur ? Number(r.original_price_eur) : undefined,
        dealUrl: targetUrl || undefined,
        anomalyType: r.anomaly_type,
        score: Number(r.score),
        reason: r.reason,
        detectedAt: r.detected_at,
        isDismissed: Boolean(r.is_dismissed)
      };
    });
  },

  dismiss(id: string): void {
    prepareStmt(`UPDATE anomalies SET is_dismissed = 1 WHERE id = ?`).run(id);
  }
};

// ----------------------------------------------------
// Helper Mappers
// ----------------------------------------------------
function mapGameRow(r: any): Game {
  let bestDealScore: number | undefined;
  let bestDealTier: DealScoreTier | undefined;

  if (r.best_price_eur !== null && r.best_price_eur !== undefined) {
    const isOfficial = r.best_merchant_is_official !== undefined && r.best_merchant_is_official !== null
      ? Boolean(r.best_merchant_is_official)
      : true;

    const dealResult = calculateDealScore({
      priceEur: Number(r.best_price_eur),
      basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
      discountPercent: r.best_discount_percent !== null && r.best_discount_percent !== undefined ? Number(r.best_discount_percent) : undefined,
      priceEvent: r.best_price_event,
      historicalLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
      isOfficialMerchant: isOfficial,
      merchantTrustScore: r.best_merchant_trust_score !== undefined && r.best_merchant_trust_score !== null ? Number(r.best_merchant_trust_score) : 1.0,
      sourceAgreementCount: r.best_source_agreement_count ? Number(r.best_source_agreement_count) : 1,
      riskLevel: r.best_risk_level || 'SAFE',
      evaluationConfidence: r.best_evaluation_confidence !== null && r.best_evaluation_confidence !== undefined ? Number(r.best_evaluation_confidence) : 1.0,
      isAnomaly: Number(r.anomaly_count || 0) > 0 || r.best_risk_level === 'HIGH'
    });
    bestDealScore = dealResult.score;
    bestDealTier = dealResult.tier;
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
    bestEvaluationConfidence: r.best_evaluation_confidence !== null && r.best_evaluation_confidence !== undefined ? Number(r.best_evaluation_confidence) : undefined,
    bestDealScore,
    bestDealTier,
    hasAnomaly: Number(r.anomaly_count || 0) > 0,
    anomalyCount: Number(r.anomaly_count || 0),
    offersCount: Number(r.offers_count || 0),
    priority: r.priority !== undefined ? Number(r.priority) : undefined,
    dateAddedSteam: r.date_added_steam || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
