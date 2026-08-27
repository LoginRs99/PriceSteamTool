import { randomUUID } from 'crypto';
import { getDb, prepareStmt } from '../core.js';
import { offerRepo } from './offer.js';
import { calculateDealScore } from '../../domain/dealScore.js';
import { generateActionSignal } from '../../domain/actionSignal.js';
import { generatePriceIntelligence } from '../../domain/priceIntelligence.js';
import { isKeyshopSourceStr } from '../../domain/priceIntelligence/types.js';
import type { 
  Game, 
  WishlistFilterOptions, 
  WishlistStatistics, 
  DealScoreTier, 
  ConfidenceTier, 
  ActionSignal, 
  PriceIntelligenceResponse 
} from '../../../shared/types.js';

export interface WishlistSyncGame {
  id: string;
  steamAppId: number;
  itadId?: string;
  title: string;
  releaseDate?: string;
  allkeyshopLastCheckedAt?: string;
  allkeyshopCheckIntervalHours?: number;
  allkeyshopUnchangedStreak?: number;
  allkeyshopLastPriceEur?: number;
  targetPriceEur?: number;
}

export interface WishlistFilterClauseResult {
  whereSql: string;
  params: any[];
}

export function buildWishlistFilterClause(
  profileId: string, 
  options: WishlistFilterOptions = {}
): WishlistFilterClauseResult {
  const params: any[] = [profileId];
  const whereClauses = [`w.profile_id = ?`, `w.is_active = 1`];

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

  return { whereSql, params };
}

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
    const isKeyshop = isKeyshopSourceStr(source);
    prepareStmt(`
      UPDATE games 
      SET historical_low_eur = ?, 
          historical_low_date = ?, 
          historical_low_source = ?,
          atl_is_confirmed = ?,
          atl_is_single_source_low = ?,
          updated_at = datetime('now')
      WHERE id = ? AND (historical_low_eur IS NULL OR ? < historical_low_eur)
    `).run(priceEur, date, source, isKeyshop ? 0 : 1, isKeyshop ? 1 : 0, gameId, priceEur);
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
        COUNT(DISTINCT CASE WHEN (g.is_free = 0 OR g.is_free IS NULL) AND (bo.discount_percent > 0 OR (g.base_price_eur > 0 AND bo.price_eur < g.base_price_eur)) THEN w.game_id END) as games_on_sale,
        COUNT(DISTINCT CASE WHEN (g.is_free = 0 OR g.is_free IS NULL) AND bo.price_event IN ('NEW_HISTORICAL_LOW', 'AT_HISTORICAL_LOW') THEN w.game_id END) as games_at_historical_low,
        COUNT(DISTINCT CASE WHEN (g.is_free = 0 OR g.is_free IS NULL) AND bo.price_event IN ('MAJOR_DROP', 'EXTREME_DROP') THEN w.game_id END) as major_drops_count,
        COUNT(DISTINCT CASE WHEN (g.is_free = 0 OR g.is_free IS NULL) AND EXISTS (SELECT 1 FROM offers ho WHERE ho.game_id = w.game_id AND ho.risk_level = 'HIGH' AND ho.is_valid = 1) THEN w.game_id END) as games_with_high_risk,
        AVG(CASE 
          WHEN (g.is_free = 0 OR g.is_free IS NULL) AND (bo.discount_percent > 0 OR (g.base_price_eur > 0 AND bo.price_eur < g.base_price_eur)) THEN 
            CASE 
              WHEN bo.discount_percent > 0 THEN bo.discount_percent 
              ELSE ROUND(((g.base_price_eur - bo.price_eur) / g.base_price_eur) * 100) 
            END 
        END) as avg_discount
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
    const { whereSql, params } = buildWishlistFilterClause(profileId, options);

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
        g.release_date,
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
      releaseDate: r.release_date || undefined,
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
        g.release_date,
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
      releaseDate: r.release_date || undefined,
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
      : (r.historical_low_source ? (!isKeyshopSourceStr(r.historical_low_source) && (r.historical_low_source === 'Steam' || r.historical_low_source === 'ITAD' || r.historical_low_source.includes('Official') || r.historical_low_source.includes('CheapShark') || r.historical_low_source.includes('GG.deals'))) : false);
    const isSingleSourceLow = r.atl_is_single_source_low !== null && r.atl_is_single_source_low !== undefined
      ? Boolean(r.atl_is_single_source_low)
      : (r.historical_low_source ? isKeyshopSourceStr(r.historical_low_source) : false);

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
    bestLastObservedAt: r.best_last_observed_at || r.last_observed_at || undefined,
    bestIsFresh: r.best_price_eur !== null && r.best_price_eur !== undefined
      ? (!isNaN(new Date(r.best_last_observed_at || r.last_observed_at || '').getTime()) &&
         (Date.now() - new Date(r.best_last_observed_at || r.last_observed_at || '').getTime()) <= 72 * 60 * 60 * 1000)
      : undefined,
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
