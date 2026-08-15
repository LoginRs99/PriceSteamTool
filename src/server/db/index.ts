import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { SCHEMA_SQL, SEED_SOURCES_SQL } from './schema.js';
import type { 
  Profile, 
  Game, 
  Merchant, 
  Offer, 
  SourceCode, 
  CircuitState,
  SourceStatus,
  WishlistFilterOptions,
  PriceHistoryEntry,
  Anomaly
} from '../../shared/types.js';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(config.dbPath);
    dbInstance.exec(SCHEMA_SQL);
    dbInstance.exec(SEED_SOURCES_SQL);
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// ----------------------------------------------------
// Profile Repository
// ----------------------------------------------------
export const profileRepo = {
  list(): Profile[] {
    const db = getDb();
    const rows = db.prepare(`
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
    const db = getDb();
    const row = db.prepare(`SELECT * FROM profiles WHERE is_active = 1 LIMIT 1`).get() as any;
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
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    
    // If this is the first profile, make it active
    const count = (db.prepare(`SELECT COUNT(*) as count FROM profiles`).get() as any).count;
    const isActive = count === 0 ? 1 : 0;

    db.prepare(`
      INSERT INTO profiles (id, name, steam_id, custom_url, avatar_url, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, steamId, customUrl || null, avatarUrl || null, isActive, now, now);

    return { id, name, steamId, customUrl, avatarUrl, isActive: Boolean(isActive), createdAt: now, updatedAt: now };
  },

  setActive(id: string): void {
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare(`UPDATE profiles SET is_active = 0`).run();
      db.prepare(`UPDATE profiles SET is_active = 1 WHERE id = ?`).run(id);
    });
    tx();
  },

  update(id: string, name: string, steamId: string, customUrl?: string, avatarUrl?: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE profiles 
      SET name = ?, steam_id = ?, custom_url = ?, avatar_url = ?, updated_at = ?
      WHERE id = ?
    `).run(name, steamId, customUrl || null, avatarUrl || null, now, id);
  },

  delete(id: string): void {
    const db = getDb();
    db.prepare(`DELETE FROM profiles WHERE id = ?`).run(id);
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
    const db = getDb();
    const now = new Date().toISOString();
    const slug = game.slug || game.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    const existing = db.prepare(`SELECT * FROM games WHERE steam_app_id = ?`).get(game.steamAppId) as any;
    if (existing) {
      db.prepare(`
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
      return this.getById(existing.id)!;
    }

    const id = randomUUID();
    db.prepare(`
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

    return this.getById(id)!;
  },

  getById(id: string): Game | null {
    const db = getDb();
    const r = db.prepare(`
      SELECT g.*, 
        bo.id as best_offer_id,
        bo.price_eur as best_price_eur,
        bo.discount_percent as best_discount_percent,
        bo.product_type as best_product_type,
        bo.region_type as best_region_type,
        bo.deal_url as best_deal_url,
        m.name as best_merchant_name,
        m.code as best_merchant_code,
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
    const db = getDb();
    const r = db.prepare(`SELECT id FROM games WHERE steam_app_id = ?`).get(steamAppId) as any;
    if (!r) return null;
    return this.getById(r.id);
  },

  updateItadId(steamAppId: number, itadId: string): void {
    const db = getDb();
    db.prepare(`UPDATE games SET itad_id = ?, updated_at = datetime('now') WHERE steam_app_id = ?`).run(itadId, steamAppId);
  },

  updateHistoricalLow(gameId: string, priceEur: number, date: string, source: string): void {
    const db = getDb();
    db.prepare(`
      UPDATE games 
      SET historical_low_eur = ?, 
          historical_low_date = ?, 
          historical_low_source = ?,
          updated_at = datetime('now')
      WHERE id = ? AND (historical_low_eur IS NULL OR ? < historical_low_eur)
    `).run(priceEur, date, source, gameId, priceEur);
  },

  getWishlistGames(profileId: string, options: WishlistFilterOptions = {}): { games: Game[]; total: number } {
    const db = getDb();
    const params: any[] = [profileId];
    let whereClauses = [`w.profile_id = ?`, `w.is_active = 1`];

    if (options.search && options.search.trim() !== '') {
      whereClauses.push(`g.title LIKE ?`);
      params.push(`%${options.search.trim()}%`);
    }

    if (options.saleOnly) {
      whereClauses.push(`bo.discount_percent > 0`);
    }

    if (options.historicalLowOnly) {
      whereClauses.push(`bo.price_eur <= g.historical_low_eur * 1.05 AND bo.price_eur IS NOT NULL`);
    }

    if (options.underPrice !== undefined && options.underPrice > 0) {
      whereClauses.push(`bo.price_eur <= ?`);
      params.push(options.underPrice);
    }

    if (options.hasAnomaly) {
      whereClauses.push(`(SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_anomaly = 1) > 0`);
    }

    if (options.merchantType === 'official_only') {
      whereClauses.push(`m.is_official = 1`);
    } else if (options.merchantType === 'keyshop_only') {
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

    const countRow = db.prepare(`
      SELECT COUNT(*) as total 
      FROM wishlist_entries w
      JOIN games g ON w.game_id = g.id
      LEFT JOIN offers bo ON bo.game_id = g.id AND bo.is_best_deal = 1
      LEFT JOIN merchants m ON bo.merchant_id = m.id
      ${whereSql}
    `).get(...params) as any;

    const limit = Math.min(options.limit || 50, 500);
    const page = Math.max(options.page || 1, 1);
    const offset = (page - 1) * limit;

    const rows = db.prepare(`
      SELECT g.*, 
        w.priority,
        w.date_added_steam,
        bo.id as best_offer_id,
        bo.price_eur as best_price_eur,
        bo.discount_percent as best_discount_percent,
        bo.product_type as best_product_type,
        bo.region_type as best_region_type,
        bo.deal_url as best_deal_url,
        m.name as best_merchant_name,
        m.code as best_merchant_code,
        (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1) as offers_count,
        (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_anomaly = 1) as anomaly_count
      FROM wishlist_entries w
      JOIN games g ON w.game_id = g.id
      LEFT JOIN offers bo ON bo.game_id = g.id AND bo.is_best_deal = 1
      LEFT JOIN merchants m ON bo.merchant_id = m.id
      ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    return {
      games: rows.map(mapGameRow),
      total: Number(countRow?.total || 0)
    };
  },

  getAllWishlistGameIds(profileId: string): { id: string; steamAppId: number; itadId?: string; title: string }[] {
    const db = getDb();
    const rows = db.prepare(`
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
    const db = getDb();
    const rows = db.prepare(`
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

  syncWishlistEntries(profileId: string, items: { steamAppId: number; title: string; priority: number; dateAdded?: string }[]): void {
    const db = getDb();
    const now = new Date().toISOString();
    
    const tx = db.transaction(() => {
      // Mark existing entries as inactive first
      db.prepare(`UPDATE wishlist_entries SET is_active = 0 WHERE profile_id = ?`).run(profileId);

      for (const item of items) {
        // Ensure game exists
        const game = gameRepo.upsert({
          steamAppId: item.steamAppId,
          title: item.title,
        });

        // Insert or update wishlist entry
        const entryId = randomUUID();
        db.prepare(`
          INSERT INTO wishlist_entries (id, profile_id, game_id, priority, date_added_steam, is_active, last_synced_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(profile_id, game_id) DO UPDATE SET
            priority = excluded.priority,
            date_added_steam = COALESCE(excluded.date_added_steam, wishlist_entries.date_added_steam),
            is_active = 1,
            last_synced_at = excluded.last_synced_at
        `).run(entryId, profileId, game.id, item.priority, item.dateAdded || null, now);
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
    const db = getDb();
    const row = db.prepare(`SELECT * FROM merchants WHERE code = ?`).get(code) as any;
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
    db.prepare(`
      INSERT INTO merchants (id, code, name, default_url, is_official, trust_score, created_at)
      VALUES (?, ?, ?, ?, ?, 1.0, ?)
    `).run(id, code, name, defaultUrl || null, isOfficial ? 1 : 0, now);

    return { id, code, name, defaultUrl, isOfficial, trustScore: 1.0 };
  },

  list(): Merchant[] {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM merchants ORDER BY is_official DESC, name ASC`).all() as any[];
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
    discountPercent?: number;
    voucherCode?: string;
    dealUrl: string;
    isValid?: boolean;
    isAnomaly?: boolean;
    anomalyScore?: number;
    anomalyReason?: string;
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
      const existing = db.prepare(`
        SELECT id, price_eur FROM offers 
        WHERE game_id = ? AND merchant_id = ? AND product_type = ? AND region_type = ?
      `).get(data.gameId, data.merchantId, data.productType, data.regionType) as any;

      if (existing) {
        offerId = existing.id;
        db.prepare(`
          UPDATE offers
          SET price_eur = ?,
              original_price_eur = COALESCE(?, original_price_eur),
              discount_percent = ?,
              voucher_code = COALESCE(?, voucher_code),
              deal_url = ?,
              is_valid = ?,
              is_anomaly = ?,
              anomaly_score = ?,
              anomaly_reason = ?,
              region_confidence = ?,
              fetched_at = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          data.priceEur,
          data.originalPriceEur || null,
          discount,
          data.voucherCode || null,
          data.dealUrl,
          data.isValid !== false ? 1 : 0,
          data.isAnomaly ? 1 : 0,
          data.anomalyScore || 0.0,
          data.anomalyReason || null,
          data.regionConfidence !== undefined ? data.regionConfidence : 1.0,
          now,
          now,
          offerId
        );
      } else {
        offerId = randomUUID();
        db.prepare(`
          INSERT INTO offers (
            id, game_id, merchant_id, product_type, region_type, region_code, region_confidence,
            price_eur, original_price_eur, discount_percent, voucher_code, deal_url,
            is_best_deal, is_valid, is_anomaly, anomaly_score, anomaly_reason, fetched_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
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
          discount,
          data.voucherCode || null,
          data.dealUrl,
          data.isValid !== false ? 1 : 0,
          data.isAnomaly ? 1 : 0,
          data.anomalyScore || 0.0,
          data.anomalyReason || null,
          now,
          now,
          now
        );
      }

      // Record / update source observation
      const obsId = randomUUID();
      db.prepare(`
        INSERT INTO source_observations (id, offer_id, source_code, observed_price_eur, observed_at, raw_data_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(offer_id, source_code) DO UPDATE SET
          observed_price_eur = excluded.observed_price_eur,
          observed_at = excluded.observed_at,
          raw_data_json = excluded.raw_data_json
      `).run(obsId, offerId, data.sourceCode, data.priceEur, now, data.rawObservationJson || null);

      // Record price history only if price or discount actually changed
      const lastHistory = db.prepare(`
        SELECT price_eur, discount_percent FROM price_history 
        WHERE game_id = ? AND merchant_id = ? 
        ORDER BY recorded_at DESC LIMIT 1
      `).get(data.gameId, data.merchantId) as any;

      if (!lastHistory || lastHistory.price_eur !== data.priceEur || lastHistory.discount_percent !== discount) {
        db.prepare(`
          INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, discount_percent, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), data.gameId, data.merchantId, data.sourceCode, data.priceEur, discount, now);
      }

      // Recalculate best deal for this game
      offerRepo.recomputeBestDealForGame(data.gameId);

      return offerId;
    });

    const offerId = tx();
    return this.getById(offerId)!;
  },

  getById(id: string): Offer | null {
    const db = getDb();
    const r = db.prepare(`
      SELECT o.*, m.name as merchant_name, m.code as merchant_code, m.is_official
      FROM offers o
      JOIN merchants m ON o.merchant_id = m.id
      WHERE o.id = ?
    `).get(id) as any;

    if (!r) return null;

    const sources = db.prepare(`
      SELECT source_code FROM source_observations WHERE offer_id = ?
    `).all(id) as any[];

    return {
      id: r.id,
      gameId: r.game_id,
      merchantId: r.merchant_id,
      merchantName: r.merchant_name,
      merchantCode: r.merchant_code,
      isOfficial: Boolean(r.is_official),
      productType: r.product_type,
      regionType: r.region_type,
      regionCode: r.region_code || undefined,
      regionConfidence: Number(r.region_confidence),
      priceEur: Number(r.price_eur),
      originalPriceEur: r.original_price_eur ? Number(r.original_price_eur) : undefined,
      discountPercent: Number(r.discount_percent),
      voucherCode: r.voucher_code || undefined,
      dealUrl: r.deal_url,
      isBestDeal: Boolean(r.is_best_deal),
      isValid: Boolean(r.is_valid),
      isAnomaly: Boolean(r.is_anomaly),
      anomalyScore: Number(r.anomaly_score),
      anomalyReason: r.anomaly_reason || undefined,
      sources: sources.map(s => s.source_code as SourceCode),
      fetchedAt: r.fetched_at
    };
  },

  getOffersForGame(gameId: string): Offer[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT o.*, m.name as merchant_name, m.code as merchant_code, m.is_official
      FROM offers o
      JOIN merchants m ON o.merchant_id = m.id
      WHERE o.game_id = ?
      ORDER BY o.is_valid DESC, o.price_eur ASC
    `).all(gameId) as any[];

    return rows.map(r => {
      const sources = db.prepare(`
        SELECT source_code FROM source_observations WHERE offer_id = ?
      `).all(r.id) as any[];

      return {
        id: r.id,
        gameId: r.game_id,
        merchantId: r.merchant_id,
        merchantName: r.merchant_name,
        merchantCode: r.merchant_code,
        isOfficial: Boolean(r.is_official),
        productType: r.product_type,
        regionType: r.region_type,
        regionCode: r.region_code || undefined,
        regionConfidence: Number(r.region_confidence),
        priceEur: Number(r.price_eur),
        originalPriceEur: r.original_price_eur ? Number(r.original_price_eur) : undefined,
        discountPercent: Number(r.discount_percent),
        voucherCode: r.voucher_code || undefined,
        dealUrl: r.deal_url,
        isBestDeal: Boolean(r.is_best_deal),
        isValid: Boolean(r.is_valid),
        isAnomaly: Boolean(r.is_anomaly),
        anomalyScore: Number(r.anomaly_score),
        anomalyReason: r.anomaly_reason || undefined,
        sources: sources.map(s => s.source_code as SourceCode),
        fetchedAt: r.fetched_at
      };
    });
  },

  recomputeBestDealForGame(gameId: string): void {
    const db = getDb();
    // Clear existing best deal flag
    db.prepare(`UPDATE offers SET is_best_deal = 0 WHERE game_id = ?`).run(gameId);

    // Find the cheapest valid offer
    const best = db.prepare(`
      SELECT id FROM offers 
      WHERE game_id = ? AND is_valid = 1 
      ORDER BY price_eur ASC 
      LIMIT 1
    `).get(gameId) as any;

    if (best) {
      db.prepare(`UPDATE offers SET is_best_deal = 1 WHERE id = ?`).run(best.id);
    }
  },

  getPriceHistory(gameId: string, limit: number = 100): PriceHistoryEntry[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT ph.*, m.name as merchant_name
      FROM price_history ph
      JOIN merchants m ON ph.merchant_id = m.id
      WHERE ph.game_id = ?
      ORDER BY ph.recorded_at DESC
      LIMIT ?
    `).all(gameId, limit) as any[];

    return rows.map(r => ({
      id: r.id,
      gameId: r.game_id,
      merchantName: r.merchant_name,
      sourceCode: r.source_code as SourceCode,
      priceEur: Number(r.price_eur),
      discountPercent: r.discount_percent ? Number(r.discount_percent) : undefined,
      recordedAt: r.recorded_at
    }));
  }
};

// ----------------------------------------------------
// Source & Diagnostics Repository
// ----------------------------------------------------
export const sourceRepo = {
  list(): SourceStatus[] {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM sources ORDER BY priority ASC`).all() as any[];
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
    const db = getDb();
    db.prepare(`
      UPDATE sources 
      SET state = ?, cooldown_until = ?, updated_at = datetime('now') 
      WHERE code = ?
    `).run(state, cooldownUntil || null, code);
  },

  incrementCounters(code: SourceCode, status: 'success' | 'failure' | 'ratelimit', errorMessage?: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    if (status === 'success') {
      db.prepare(`
        UPDATE sources 
        SET request_count = request_count + 1, 
            success_count = success_count + 1, 
            last_success_at = ?,
            updated_at = ?
        WHERE code = ?
      `).run(now, now, code);
    } else if (status === 'ratelimit') {
      db.prepare(`
        UPDATE sources 
        SET request_count = request_count + 1, 
            rate_limit_count = rate_limit_count + 1,
            last_error = ?,
            updated_at = ?
        WHERE code = ?
      `).run(errorMessage || 'Rate limit encountered (429)', now, code);
    } else {
      db.prepare(`
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
    const db = getDb();
    db.prepare(`UPDATE sources SET is_enabled = ?, updated_at = datetime('now') WHERE code = ?`).run(isEnabled ? 1 : 0, code);
  }
};

// ----------------------------------------------------
// Anomaly Repository
// ----------------------------------------------------
export const anomalyRepo = {
  record(gameId: string, offerId: string, type: Anomaly['anomalyType'], score: number, reason: string): void {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO anomalies (id, game_id, offer_id, anomaly_type, score, reason, detected_at, is_dismissed)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(id, gameId, offerId, type, score, reason, now);
  },

  list(onlyActive: boolean = true): Anomaly[] {
    const db = getDb();
    const sql = onlyActive 
      ? `SELECT a.*, g.title as game_title, m.name as merchant_name 
         FROM anomalies a 
         JOIN games g ON a.game_id = g.id
         JOIN offers o ON a.offer_id = o.id
         JOIN merchants m ON o.merchant_id = m.id
         WHERE a.is_dismissed = 0
         ORDER BY a.detected_at DESC`
      : `SELECT a.*, g.title as game_title, m.name as merchant_name 
         FROM anomalies a 
         JOIN games g ON a.game_id = g.id
         JOIN offers o ON a.offer_id = o.id
         JOIN merchants m ON o.merchant_id = m.id
         ORDER BY a.detected_at DESC`;

    const rows = db.prepare(sql).all() as any[];
    return rows.map(r => ({
      id: r.id,
      gameId: r.game_id,
      offerId: r.offer_id,
      gameTitle: r.game_title,
      merchantName: r.merchant_name,
      anomalyType: r.anomaly_type,
      score: Number(r.score),
      reason: r.reason,
      detectedAt: r.detected_at,
      isDismissed: Boolean(r.is_dismissed)
    }));
  },

  dismiss(id: string): void {
    const db = getDb();
    db.prepare(`UPDATE anomalies SET is_dismissed = 1 WHERE id = ?`).run(id);
  }
};

// ----------------------------------------------------
// Helper Mappers
// ----------------------------------------------------
function mapGameRow(r: any): Game {
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
    bestProductType: r.best_product_type || undefined,
    bestRegionType: r.best_region_type || undefined,
    bestDiscountPercent: r.best_discount_percent !== null && r.best_discount_percent !== undefined ? Number(r.best_discount_percent) : undefined,
    bestDealUrl: r.best_deal_url || undefined,
    bestOfferId: r.best_offer_id || undefined,
    hasAnomaly: Number(r.anomaly_count || 0) > 0,
    offersCount: Number(r.offers_count || 0),
    priority: r.priority !== undefined ? Number(r.priority) : undefined,
    dateAddedSteam: r.date_added_steam || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
