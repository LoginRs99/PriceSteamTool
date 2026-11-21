import { randomUUID } from 'crypto';
import { getDb, prepareStmt } from '../core.js';
import { offerRepo } from './offer.js';
import { calculateDealScore, calculateShoppingScore, calculateCredibleSavings } from '../../domain/dealScore.js';
import { generateActionSignal } from '../../domain/actionSignal.js';
import { generatePriceIntelligence } from '../../domain/priceIntelligence.js';
import { isKeyshopSourceStr, isOfficialStoreSource, isAggregatorSource } from '../../domain/priceIntelligence/types.js';
import { FRESHNESS_WINDOW_MS } from '../../domain/constants.js';
import { calculateSteamDbRating } from '../../domain/rating.js';
import { repairMojibake, isGameUnreleased, isGameDelisted } from '../../domain/normalizer.js';
import { getGameSubscriptions } from '../../domain/subscriptions.js';
import type { 
  Game, 
  WishlistFilterOptions, 
  WishlistStatistics, 
  DealScoreTier, 
  ConfidenceTier, 
  DealVerdict,
  DealScoreResult,
  ActionSignal, 
  PriceIntelligenceResponse 
} from '../../../shared/types.js';

export interface WishlistSyncGame {
  id: string;
  steamAppId: number;
  itadId?: string;
  title: string;
  releaseDate?: string;
  priceHistorySeededAt?: string;
  allkeyshopLastCheckedAt?: string;
  allkeyshopCheckIntervalHours?: number;
  allkeyshopUnchangedStreak?: number;
  allkeyshopLastPriceEur?: number;
  targetPriceEur?: number;
  priority?: number;
  metacriticScore?: number;
  metacriticUrl?: string;
}

export interface WishlistFilterClauseResult {
  whereSql: string;
  params: any[];
}

export interface BestDealsOptions {
  minTier?: string;
  hideFamilyShared?: boolean;
  merchantType?: 'all' | 'official' | 'keyshop';
  maxPrice?: number;
  search?: string;
  sort?: 'value' | 'deal_score' | 'savings' | 'discount' | 'price' | 'rating' | 'priority';
  page?: number;
  asResultObject?: boolean;
}

export interface BestDealsResult {
  deals: Game[];
  total: number;
  page: number;
  totalPages: number;
}

export function buildWishlistFilterClause(
  profileId: string, 
  options: WishlistFilterOptions = {}
): WishlistFilterClauseResult {
  const params: any[] = [profileId];
  const whereClauses = [`w.profile_id = ?`, `w.is_active = 1`];

  if (options.search && options.search.trim() !== '') {
    whereClauses.push(`g.title LIKE ?`);
    params.push(`%${options.search.trim()}%`);
  }

  if (options.steamAppId !== undefined) {
    whereClauses.push(`g.steam_app_id = ?`);
    params.push(options.steamAppId);
  }

  if (options.saleOnly) {
    whereClauses.push(`(bo.discount_percent > 0 OR (g.base_price_eur IS NOT NULL AND bo.price_eur < g.base_price_eur))`);
  }

  if (options.minDiscount !== undefined && options.minDiscount > 0) {
    whereClauses.push(`bo.discount_percent >= ?`);
    params.push(options.minDiscount);
  }

  if (options.majorDealsOnly) {
    whereClauses.push(`(bo.price_event IN ('MAJOR_DROP', 'EXTREME_DROP') OR bo.discount_percent >= 50 OR (g.base_price_eur IS NOT NULL AND g.base_price_eur > 0 AND bo.price_eur <= g.base_price_eur * 0.5))`);
  }

  if (options.rareSalesOnly) {
    whereClauses.push(`g.sale_cadence = 'RARE_SALE'`);
  }

  if (options.subscriptionOnly) {
    whereClauses.push(`(g.subscription_services IS NOT NULL AND g.subscription_services != '')`);
  }

  if (options.officialHistoricalLowOnly) {
    whereClauses.push(`(m.is_official = 1 AND g.official_historical_low_eur IS NOT NULL AND g.official_historical_low_eur > 0 AND bo.price_eur <= g.official_historical_low_eur * 1.02)`);
  }

  if (options.freshDropsDays !== undefined && options.freshDropsDays > 0) {
    whereClauses.push(`EXISTS (
      SELECT 1 FROM price_history ph 
      WHERE ph.game_id = g.id 
        AND ph.is_pricing_error = 0 
        AND COALESCE(ph.identity_confidence, 'CONFIDENT') != 'AMBIGUOUS'
        AND ph.price_event NOT IN ('NONE', 'PRICE_INCREASE', 'PRICING_ERROR', 'NEW_OFFER')
        AND datetime(ph.recorded_at) >= datetime('now', '-' || ? || ' days')
    )`);
    params.push(options.freshDropsDays);
  }

  if (options.allTimeLowOnly || options.historicalLowOnly) {
    whereClauses.push(`(bo.price_event IN ('NEW_HISTORICAL_LOW', 'AT_HISTORICAL_LOW', 'RECORD_DROP', 'UNCONFIRMED_RECORD_DROP') OR (g.historical_low_eur IS NOT NULL AND g.historical_low_eur > 0 AND bo.price_eur <= g.historical_low_eur * 1.02))`);
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

  if (options.hasPricingErrors) {
    whereClauses.push(`(SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_likely_pricing_error = 1) > 0`);
  }

  if (options.targetReachedOnly) {
    whereClauses.push(`w.target_price_eur IS NOT NULL AND bo.price_eur IS NOT NULL AND bo.price_eur <= w.target_price_eur`);
  }

  if (options.minMetacritic !== undefined && options.minMetacritic > 0) {
    whereClauses.push(`g.metacritic_score >= ?`);
    params.push(options.minMetacritic);
  }

  if (options.minSteamRating !== undefined && options.minSteamRating > 0) {
    whereClauses.push(`g.steam_review_percent >= ?`);
    params.push(options.minSteamRating);
  }

  if (options.belowTypicalSaleOnly) {
    whereClauses.push(`g.typical_sale_median_eur IS NOT NULL AND bo.price_eur IS NOT NULL AND bo.price_eur < g.typical_sale_median_eur`);
  }

  // Unreleased / Coming soon filtering
  // When hideUnreleased is true, exclude games that have no price observations AND either have no release date,
  // a release date containing 'coming soon'/'tba', or a future timestamp.
  if (options.hideUnreleased) {
    whereClauses.push(`(
      (bo.price_eur IS NOT NULL AND bo.price_eur > 0) OR
      (g.base_price_eur IS NOT NULL AND g.base_price_eur > 0) OR
      (
        g.release_date IS NOT NULL 
        AND LOWER(g.release_date) NOT LIKE '%coming soon%'
        AND LOWER(g.release_date) NOT LIKE '%tba%'
        AND LOWER(g.release_date) NOT LIKE '%to be announced%'
        AND (
          g.release_date <= date('now')
          OR length(g.release_date) = 4 AND g.release_date <= strftime('%Y', 'now')
        )
      )
    )`);
  }

  // DLC filtering
  if (options.hideDlcs) {
    whereClauses.push(`(g.is_dlc = 0 OR g.is_dlc IS NULL)`);
  }

  // Family Shared filtering (respects exclusions)
  if (options.hideFamilyShared) {
    whereClauses.push(`NOT EXISTS (
      SELECT 1 FROM family_owned_apps fo
      JOIN profiles fp ON fo.profile_id = fp.id
      WHERE fp.is_family = 1 AND fo.steam_app_id = g.steam_app_id
        AND NOT EXISTS (SELECT 1 FROM family_sharing_exclusions fse WHERE fse.steam_app_id = g.steam_app_id)
    )`);
  }

  // Free games filtering (isFreeOnly vs includeFreeGames)
  if (options.isFreeOnly === true) {
    whereClauses.push(`((g.is_free = 1 OR g.base_price_eur = 0) OR bo.price_eur = 0)`);
  } else if (!options.includeFreeGames) {
    whereClauses.push(`(g.is_free = 0 OR g.is_free IS NULL) AND (bo.price_eur IS NULL OR bo.price_eur > 0)`);
  }

  // Storefront classification filtering (Official vs Keyshop)
  if (options.merchantType === 'official' || options.merchantType === 'official_only') {
    whereClauses.push(`m.is_official = 1`);
  } else if (options.merchantType === 'keyshop' || options.merchantType === 'keyshop_only') {
    whereClauses.push(`m.is_official = 0`);
  }

  if (options.priceEvent) {
    whereClauses.push(`bo.price_event = ?`);
    params.push(options.priceEvent);
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
    steamReviewDesc?: string;
    steamReviewPercent?: number;
    steamReviewTotal?: string;
    steamdbRating?: number;
    metacriticScore?: number;
    metacriticUrl?: string;
  }): Game {
    const now = new Date().toISOString();
    const slug = game.slug || game.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const calculatedSteamdbRating = game.steamdbRating !== undefined 
      ? game.steamdbRating 
      : (game.steamReviewPercent !== undefined && game.steamReviewTotal ? calculateSteamDbRating(game.steamReviewPercent, game.steamReviewTotal) : undefined);
    
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
            steam_review_desc = COALESCE(?, steam_review_desc),
            steam_review_percent = COALESCE(?, steam_review_percent),
            steam_review_total = COALESCE(?, steam_review_total),
            steamdb_rating = COALESCE(?, steamdb_rating),
            metacritic_score = COALESCE(?, metacritic_score),
            metacritic_url = COALESCE(?, metacritic_url),
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
        game.steamReviewDesc || null,
        game.steamReviewPercent !== undefined ? game.steamReviewPercent : null,
        game.steamReviewTotal || null,
        calculatedSteamdbRating !== undefined ? calculatedSteamdbRating : null,
        game.metacriticScore !== undefined ? game.metacriticScore : null,
        game.metacriticUrl || null,
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
        steamReviewDesc: game.steamReviewDesc || existing.steam_review_desc || undefined,
        steamReviewPercent: game.steamReviewPercent !== undefined ? game.steamReviewPercent : (existing.steam_review_percent !== null && existing.steam_review_percent !== undefined ? Number(existing.steam_review_percent) : undefined),
        steamReviewTotal: game.steamReviewTotal || existing.steam_review_total || undefined,
        steamdbRating: calculatedSteamdbRating !== undefined ? calculatedSteamdbRating : (existing.steamdb_rating !== null && existing.steamdb_rating !== undefined ? Number(existing.steamdb_rating) : undefined),
        metacriticScore: game.metacriticScore !== undefined ? game.metacriticScore : (existing.metacritic_score !== null && existing.metacritic_score !== undefined ? Number(existing.metacritic_score) : undefined),
        metacriticUrl: game.metacriticUrl || existing.metacritic_url || undefined,
        hasPricingError: false,
        offersCount: 0,
        createdAt: existing.created_at,
        updatedAt: now
      };
    }

    const id = randomUUID();
    prepareStmt(`
      INSERT INTO games (id, steam_app_id, itad_id, title, slug, header_image, capsule_image, release_date, is_dlc, is_free, base_price_eur, historical_low_eur, historical_low_date, historical_low_source, steam_review_desc, steam_review_percent, steam_review_total, steamdb_rating, metacritic_score, metacritic_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      game.steamReviewDesc || null,
      game.steamReviewPercent !== undefined ? game.steamReviewPercent : null,
      game.steamReviewTotal || null,
      calculatedSteamdbRating !== undefined ? calculatedSteamdbRating : null,
      game.metacriticScore !== undefined ? game.metacriticScore : null,
      game.metacriticUrl || null,
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
      steamReviewDesc: game.steamReviewDesc,
      steamReviewPercent: game.steamReviewPercent,
      steamReviewTotal: game.steamReviewTotal,
      steamdbRating: calculatedSteamdbRating,
      metacriticScore: game.metacriticScore,
      metacriticUrl: game.metacriticUrl,
      hasPricingError: false,
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
        bo.voucher_code as best_voucher_code,
        bo.price_event as best_price_event,
        bo.last_observed_at as best_last_observed_at,
        m.name as best_merchant_name,
        m.code as best_merchant_code,
        m.is_official as best_merchant_is_official,
        (SELECT COUNT(DISTINCT source_code) FROM source_observations WHERE offer_id = bo.id) as best_source_agreement_count,
        (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1) as offers_count,
        (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_likely_pricing_error = 1 AND o.is_valid = 1) as anomaly_count,
        (SELECT MIN(o.price_eur) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1 AND o.is_likely_pricing_error = 0) as market_min_eur,
        (SELECT MAX(o.price_eur) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1 AND o.is_likely_pricing_error = 0) as market_max_eur,
        (EXISTS (SELECT 1 FROM family_owned_apps fo JOIN profiles fp ON fo.profile_id = fp.id WHERE fp.is_family = 1 AND fo.steam_app_id = g.steam_app_id AND NOT EXISTS (SELECT 1 FROM family_sharing_exclusions fse WHERE fse.steam_app_id = g.steam_app_id))) as is_family_shared,
        (SELECT MAX(ph.recorded_at) FROM price_history ph WHERE ph.game_id = g.id AND ph.is_pricing_error = 0 AND COALESCE(ph.identity_confidence, 'CONFIDENT') != 'AMBIGUOUS' AND ph.price_event NOT IN ('NONE', 'PRICE_INCREASE', 'PRICING_ERROR', 'NEW_OFFER')) as latest_price_drop_at,
        (EXISTS (SELECT 1 FROM family_owned_apps fo JOIN profiles fp ON fo.profile_id = fp.id WHERE fp.is_family = 1 AND fo.steam_app_id = g.steam_app_id AND EXISTS (SELECT 1 FROM family_sharing_exclusions fse WHERE fse.steam_app_id = g.steam_app_id))) as is_family_excluded,
        (SELECT sa.asset_url FROM steam_assets sa WHERE sa.steam_app_id = g.steam_app_id AND sa.asset_type = 'icon') as icon_url
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
    steamdbRating?: number;
    metacriticScore?: number;
    metacriticUrl?: string;
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
        steamdb_rating = COALESCE(?, steamdb_rating),
        metacritic_score = COALESCE(?, metacritic_score),
        metacritic_url = COALESCE(?, metacritic_url),
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
      details.steamdbRating !== undefined ? details.steamdbRating : null,
      details.metacriticScore !== undefined ? details.metacriticScore : null,
      details.metacriticUrl || null,
      new Date().toISOString(),
      steamAppId
    );
  },

  updateItadId(steamAppId: number, itadId: string): void {
    prepareStmt(`UPDATE games SET itad_id = ?, updated_at = datetime('now') WHERE steam_app_id = ?`).run(itadId, steamAppId);
  },

  updateNexardaId(steamAppId: number, nexardaId: number): void {
    prepareStmt(`UPDATE games SET nexarda_id = ?, updated_at = datetime('now') WHERE steam_app_id = ?`).run(nexardaId, steamAppId);
  },

  updateHistoricalLow(
    gameId: string, 
    priceEur: number, 
    date: string, 
    source: string,
    options?: { isConfirmed?: boolean }
  ): void {
    if (typeof priceEur !== 'number' || isNaN(priceEur) || priceEur <= 0) {
      return;
    }
    const isKeyshop = isKeyshopSourceStr(source);
    const isConfirmed = options?.isConfirmed ?? (isOfficialStoreSource(source) ? 1 : 0);
    prepareStmt(`
      UPDATE games 
      SET historical_low_eur = ?, 
          historical_low_date = ?, 
          historical_low_source = ?,
          atl_is_confirmed = ?,
          atl_is_single_source_low = ?,
          updated_at = datetime('now')
      WHERE id = ? AND (
        historical_low_eur IS NULL 
        OR (? = 0 AND ? < historical_low_eur)
        OR (? = 1 AND ? < historical_low_eur)
      )
    `).run(
      priceEur, 
      date, 
      source, 
      isConfirmed ? 1 : 0, 
      isKeyshop ? 1 : 0, 
      gameId, 
      isKeyshop ? 1 : 0, 
      priceEur,
      isConfirmed ? 1 : 0,
      priceEur
    );
  },

  updateOfficialHistoricalLow(
    gameId: string, 
    priceEur: number, 
    date: string, 
    source: string
  ): void {
    if (typeof priceEur !== 'number' || isNaN(priceEur) || priceEur <= 0) {
      return;
    }
    prepareStmt(`
      UPDATE games 
      SET official_historical_low_eur = ?,
          official_historical_low_date = ?,
          official_historical_low_source = ?,
          historical_low_eur = CASE 
            WHEN historical_low_eur IS NOT NULL AND ? < historical_low_eur THEN ? 
            ELSE historical_low_eur 
          END,
          historical_low_date = CASE 
            WHEN historical_low_eur IS NOT NULL AND ? < historical_low_eur THEN ? 
            ELSE historical_low_date 
          END,
          historical_low_source = CASE 
            WHEN historical_low_eur IS NOT NULL AND ? < historical_low_eur THEN ? 
            ELSE historical_low_source 
          END,
          atl_is_confirmed = CASE 
            WHEN historical_low_eur IS NOT NULL AND ? < historical_low_eur THEN 1 
            ELSE atl_is_confirmed 
          END,
          updated_at = datetime('now')
      WHERE id = ? AND (
        official_historical_low_eur IS NULL 
        OR ? < official_historical_low_eur
      )
    `).run(
      priceEur,
      date,
      source,
      priceEur, priceEur,
      priceEur, date,
      priceEur, source,
      priceEur,
      gameId,
      priceEur
    );
  },

  reconcileAllHistoricalLows(): number {
    const res = prepareStmt(`
      UPDATE games
      SET historical_low_eur = (
        SELECT MIN(o.price_eur)
        FROM offers o
        JOIN merchants m ON o.merchant_id = m.id
        WHERE o.game_id = games.id AND o.is_valid = 1 AND o.is_likely_pricing_error = 0 AND o.price_eur > 0
          AND (m.is_official = 1 OR (SELECT COUNT(DISTINCT so.source_code) FROM source_observations so WHERE so.offer_id = o.id) >= 2)
      ),
      atl_is_confirmed = (
        SELECT CASE WHEN m.is_official = 1 THEN 1 ELSE 0 END
        FROM offers o
        JOIN merchants m ON o.merchant_id = m.id
        WHERE o.game_id = games.id AND o.is_valid = 1 AND o.is_likely_pricing_error = 0 AND o.price_eur > 0
          AND (m.is_official = 1 OR (SELECT COUNT(DISTINCT so.source_code) FROM source_observations so WHERE so.offer_id = o.id) >= 2)
        ORDER BY o.price_eur ASC, o.id ASC
        LIMIT 1
      ),
      historical_low_source = COALESCE((
        SELECT m.name
        FROM offers o
        JOIN merchants m ON o.merchant_id = m.id
        WHERE o.game_id = games.id AND o.is_valid = 1 AND o.is_likely_pricing_error = 0 AND o.price_eur > 0
          AND (m.is_official = 1 OR (SELECT COUNT(DISTINCT so.source_code) FROM source_observations so WHERE so.offer_id = o.id) >= 2)
        ORDER BY o.price_eur ASC, o.id ASC
        LIMIT 1
      ), games.historical_low_source),
      updated_at = datetime('now')
      WHERE id IN (
        SELECT o.game_id
        FROM offers o
        JOIN games g ON g.id = o.game_id
        JOIN merchants m ON o.merchant_id = m.id
        WHERE o.is_valid = 1 AND o.is_likely_pricing_error = 0 AND o.price_eur > 0
          AND (m.is_official = 1 OR (SELECT COUNT(DISTINCT so.source_code) FROM source_observations so WHERE so.offer_id = o.id) >= 2)
          AND g.historical_low_eur IS NOT NULL AND g.historical_low_eur > 0
        GROUP BY o.game_id
        HAVING MIN(o.price_eur) < g.historical_low_eur
      )
    `).run();
        // Heal dual ATL invariant: historical_low_eur can never be greater than official_historical_low_eur
    prepareStmt(`
      UPDATE games
      SET historical_low_eur = official_historical_low_eur,
          historical_low_date = COALESCE(official_historical_low_date, historical_low_date),
          historical_low_source = COALESCE(official_historical_low_source, historical_low_source),
          atl_is_confirmed = 1,
          updated_at = datetime('now')
      WHERE official_historical_low_eur IS NOT NULL
        AND official_historical_low_eur > 0
        AND (historical_low_eur IS NULL OR historical_low_eur > official_historical_low_eur)
    `).run();
    return res.changes;
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
        COUNT(DISTINCT CASE WHEN (g.is_free = 0 OR g.is_free IS NULL) AND (bo.price_event IN ('RECORD_DROP', 'UNCONFIRMED_RECORD_DROP', 'NEW_HISTORICAL_LOW', 'AT_HISTORICAL_LOW') OR (g.historical_low_eur IS NOT NULL AND g.historical_low_eur > 0 AND bo.price_eur <= g.historical_low_eur * 1.02)) THEN w.game_id END) as games_at_historical_low,
        COUNT(DISTINCT CASE WHEN (g.is_free = 0 OR g.is_free IS NULL) AND (bo.price_event IN ('MAJOR_DROP', 'EXTREME_DROP') OR bo.discount_percent >= 50 OR (g.base_price_eur > 0 AND bo.price_eur <= g.base_price_eur * 0.5)) THEN w.game_id END) as major_drops_count,
        COUNT(DISTINCT CASE WHEN (g.is_free = 0 OR g.is_free IS NULL) AND EXISTS (SELECT 1 FROM offers ho WHERE ho.game_id = w.game_id AND ho.is_likely_pricing_error = 1 AND ho.is_valid = 1) THEN w.game_id END) as games_with_high_risk,
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
      gamesWithPricingErrors: Number(row?.games_with_high_risk || 0),
      averageDiscountPercent: Math.round(Number(row?.avg_discount || 0))
    };
  },

  getBestDeals(
    profileId: string, 
    limit: number = 50,
    options?: BestDealsOptions
  ): Game[] {
    const hideFamilyShared = options?.hideFamilyShared ?? true;
    const minTier = options?.minTier;
    const merchantType = (options?.merchantType === 'official' || options?.merchantType === 'keyshop' || options?.merchantType === 'all')
      ? options.merchantType
      : 'all';
    const maxPrice = options?.maxPrice;
    const search = options?.search?.trim();
    const sort = options?.sort || 'value';
    const page = Math.max(1, options?.page || 1);
    const asResultObject = Boolean(options?.asResultObject);

    const familyFilterClause = hideFamilyShared ? `
        AND NOT EXISTS (
          SELECT 1 FROM family_owned_apps fo
          JOIN profiles fp ON fo.profile_id = fp.id
          WHERE fp.is_family = 1 AND fo.steam_app_id = g.steam_app_id
            AND NOT EXISTS (SELECT 1 FROM family_sharing_exclusions fse WHERE fse.steam_app_id = g.steam_app_id)
        )` : '';

    let searchClause = '';
    const queryParams: any[] = [profileId];
    if (search) {
      searchClause = ` AND g.title LIKE ? `;
      queryParams.push(`%${search}%`);
    }

    const sql = `
      WITH official_ranked AS (
        SELECT o.id, o.game_id, o.price_eur, o.discount_percent, o.deal_url, o.voucher_code,
               o.price_event, o.last_observed_at, o.product_type, o.region_type,
               o.edition_key, o.activation_platform,
               m.name as merchant_name, m.code as merchant_code, m.is_official as merchant_is_official,
               ROW_NUMBER() OVER (
                 PARTITION BY o.game_id
                 ORDER BY
                   CASE WHEN (julianday('now') - julianday(COALESCE(o.last_observed_at, o.fetched_at))) * 24 <= 168 THEN 0 ELSE 1 END ASC,
                   CASE WHEN o.edition_key = 'standard' THEN 0 ELSE 1 END ASC,
                   CASE WHEN o.activation_platform = 'steam' THEN 0 ELSE 1 END ASC,
                   o.price_eur ASC,
                   COALESCE(o.last_observed_at, o.fetched_at) DESC
               ) as rn
        FROM offers o
        JOIN merchants m ON o.merchant_id = m.id
        WHERE o.is_valid = 1 AND o.is_likely_pricing_error = 0 AND o.price_eur > 0 AND m.is_official = 1
      ),
      keyshop_ranked AS (
        SELECT o.id, o.game_id, o.price_eur, o.discount_percent, o.deal_url, o.voucher_code,
               o.price_event, o.last_observed_at, o.product_type, o.region_type,
               o.edition_key, o.activation_platform,
               m.name as merchant_name, m.code as merchant_code, m.is_official as merchant_is_official,
               ROW_NUMBER() OVER (
                 PARTITION BY o.game_id
                 ORDER BY
                   CASE WHEN (julianday('now') - julianday(COALESCE(o.last_observed_at, o.fetched_at))) * 24 <= 168 THEN 0 ELSE 1 END ASC,
                   CASE WHEN o.edition_key = 'standard' THEN 0 ELSE 1 END ASC,
                   CASE WHEN o.activation_platform = 'steam' THEN 0 ELSE 1 END ASC,
                   o.price_eur ASC,
                   COALESCE(o.last_observed_at, o.fetched_at) DESC
               ) as rn
        FROM offers o
        JOIN merchants m ON o.merchant_id = m.id
        WHERE o.is_valid = 1 AND o.is_likely_pricing_error = 0 AND o.price_eur > 0 AND m.is_official = 0
      )
      SELECT g.*, 
        w.priority,
        w.date_added_steam,
        w.target_price_eur,
        CASE
          WHEN '${merchantType}' = 'official' THEN off.id
          WHEN '${merchantType}' = 'keyshop' THEN key.id
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.id
          ELSE COALESCE(key.id, off.id)
        END as best_offer_id,
        CASE
          WHEN '${merchantType}' = 'official' THEN off.edition_key
          WHEN '${merchantType}' = 'keyshop' THEN key.edition_key
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.edition_key
          ELSE COALESCE(key.edition_key, off.edition_key)
        END as best_edition_key,
        CASE
          WHEN '${merchantType}' = 'official' THEN off.activation_platform
          WHEN '${merchantType}' = 'keyshop' THEN key.activation_platform
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.activation_platform
          ELSE COALESCE(key.activation_platform, off.activation_platform)
        END as best_activation_platform,
        CASE
          WHEN '${merchantType}' = 'official' THEN off.price_eur
          WHEN '${merchantType}' = 'keyshop' THEN key.price_eur
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.price_eur
          ELSE COALESCE(key.price_eur, off.price_eur)
        END as best_price_eur,
        CASE
          WHEN '${merchantType}' = 'official' THEN off.discount_percent
          WHEN '${merchantType}' = 'keyshop' THEN key.discount_percent
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.discount_percent
          ELSE COALESCE(key.discount_percent, off.discount_percent)
        END as best_discount_percent,
        CASE
          WHEN '${merchantType}' = 'official' THEN off.product_type
          WHEN '${merchantType}' = 'keyshop' THEN key.product_type
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.product_type
          ELSE COALESCE(key.product_type, off.product_type)
        END as best_product_type,
        CASE
          WHEN '${merchantType}' = 'official' THEN off.region_type
          WHEN '${merchantType}' = 'keyshop' THEN key.region_type
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.region_type
          ELSE COALESCE(key.region_type, off.region_type)
        END as best_region_type,
        CASE
          WHEN '${merchantType}' = 'official' THEN off.deal_url
          WHEN '${merchantType}' = 'keyshop' THEN key.deal_url
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.deal_url
          ELSE COALESCE(key.deal_url, off.deal_url)
        END as best_deal_url,
        CASE
          WHEN '${merchantType}' = 'official' THEN off.voucher_code
          WHEN '${merchantType}' = 'keyshop' THEN key.voucher_code
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.voucher_code
          ELSE COALESCE(key.voucher_code, off.voucher_code)
        END as best_voucher_code,
        CASE
          WHEN '${merchantType}' = 'official' THEN off.price_event
          WHEN '${merchantType}' = 'keyshop' THEN key.price_event
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.price_event
          ELSE COALESCE(key.price_event, off.price_event)
        END as best_price_event,
        CASE
          WHEN '${merchantType}' = 'official' THEN off.last_observed_at
          WHEN '${merchantType}' = 'keyshop' THEN key.last_observed_at
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.last_observed_at
          ELSE COALESCE(key.last_observed_at, off.last_observed_at)
        END as best_last_observed_at,
        CASE
          WHEN '${merchantType}' = 'official' THEN off.merchant_name
          WHEN '${merchantType}' = 'keyshop' THEN key.merchant_name
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.merchant_name
          ELSE COALESCE(key.merchant_name, off.merchant_name)
        END as best_merchant_name,
        CASE
          WHEN '${merchantType}' = 'official' THEN off.merchant_code
          WHEN '${merchantType}' = 'keyshop' THEN key.merchant_code
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.merchant_code
          ELSE COALESCE(key.merchant_code, off.merchant_code)
        END as best_merchant_code,
        CASE
          WHEN '${merchantType}' = 'official' THEN 1
          WHEN '${merchantType}' = 'keyshop' THEN 0
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN 1
          ELSE COALESCE(key.merchant_is_official, off.merchant_is_official)
        END as best_merchant_is_official,
        -- Alternative Offer Info (transparent side-by-side comparison)
        CASE
          WHEN '${merchantType}' = 'official' THEN key.price_eur
          WHEN '${merchantType}' = 'keyshop' THEN off.price_eur
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN key.price_eur
          ELSE off.price_eur
        END as alternative_offer_price_eur,
        CASE
          WHEN '${merchantType}' = 'official' THEN key.merchant_name
          WHEN '${merchantType}' = 'keyshop' THEN off.merchant_name
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN key.merchant_name
          ELSE off.merchant_name
        END as alternative_merchant_name,
        CASE
          WHEN '${merchantType}' = 'official' THEN 0
          WHEN '${merchantType}' = 'keyshop' THEN 1
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN 0
          ELSE 1
        END as alternative_merchant_is_official,
        (SELECT COUNT(DISTINCT source_code) FROM source_observations WHERE offer_id = CASE
          WHEN '${merchantType}' = 'official' THEN off.id
          WHEN '${merchantType}' = 'keyshop' THEN key.id
          WHEN off.id IS NOT NULL AND (key.id IS NULL OR off.price_eur <= key.price_eur) THEN off.id
          ELSE COALESCE(key.id, off.id)
        END) as best_source_agreement_count,
        (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1) as offers_count,
        (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_likely_pricing_error = 1 AND o.is_valid = 1) as anomaly_count,
        (SELECT MIN(o.price_eur) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1 AND o.is_likely_pricing_error = 0) as market_min_eur,
        (SELECT MAX(o.price_eur) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1 AND o.is_likely_pricing_error = 0) as market_max_eur,
        (EXISTS (SELECT 1 FROM family_owned_apps fo JOIN profiles fp ON fo.profile_id = fp.id WHERE fp.is_family = 1 AND fo.steam_app_id = g.steam_app_id AND NOT EXISTS (SELECT 1 FROM family_sharing_exclusions fse WHERE fse.steam_app_id = g.steam_app_id))) as is_family_shared,
        (SELECT MAX(ph.recorded_at) FROM price_history ph WHERE ph.game_id = g.id AND ph.is_pricing_error = 0 AND COALESCE(ph.identity_confidence, 'CONFIDENT') != 'AMBIGUOUS' AND ph.price_event NOT IN ('NONE', 'PRICE_INCREASE', 'PRICING_ERROR', 'NEW_OFFER')) as latest_price_drop_at,
        (EXISTS (SELECT 1 FROM family_owned_apps fo JOIN profiles fp ON fo.profile_id = fp.id WHERE fp.is_family = 1 AND fo.steam_app_id = g.steam_app_id AND EXISTS (SELECT 1 FROM family_sharing_exclusions fse WHERE fse.steam_app_id = g.steam_app_id))) as is_family_excluded
      FROM wishlist_entries w
      JOIN games g ON w.game_id = g.id
      LEFT JOIN official_ranked off ON off.game_id = g.id AND off.rn = 1
      LEFT JOIN keyshop_ranked key ON key.game_id = g.id AND key.rn = 1
      WHERE w.profile_id = ? AND w.is_active = 1
        AND (g.is_free = 0 OR g.is_free IS NULL)
        AND (
          ('${merchantType}' = 'official' AND off.id IS NOT NULL) OR
          ('${merchantType}' = 'keyshop' AND key.id IS NOT NULL) OR
          ('${merchantType}' = 'all' AND (off.id IS NOT NULL OR key.id IS NOT NULL))
        )
        ${familyFilterClause}
        ${searchClause}
    `;

    const rows = prepareStmt(sql).all(...queryParams) as any[];

    const qualifyingTiers = minTier ? new Set(['Exceptional', 'Great', 'Good']) : null;
    let games = rows
      .map(mapGameRow)
      .filter(g => !qualifyingTiers || (g.bestDealTier && qualifyingTiers.has(g.bestDealTier)))
      .filter(g => {
        if (g.bestPriceEur === undefined || g.bestPriceEur <= 0) return false;
        if (g.bestDiscountPercent !== undefined && g.bestDiscountPercent > 0) return true;
        if (g.basePriceEur !== undefined && g.bestPriceEur < g.basePriceEur) return true;
        return false;
      });

    if (maxPrice !== undefined && maxPrice > 0) {
      games = games.filter(g => g.bestPriceEur !== undefined && g.bestPriceEur <= maxPrice);
    }

    games.sort((a, b) => {
      if (sort === 'value') {
        const diff = (b.shoppingScore ?? 0) - (a.shoppingScore ?? 0);
        if (diff !== 0) return diff;
      } else if (sort === 'deal_score') {
        const diff = (b.bestDealScore ?? 0) - (a.bestDealScore ?? 0);
        if (diff !== 0) return diff;
      } else if (sort === 'savings') {
        const savA = calculateCredibleSavings(a.bestPriceEur, a.basePriceEur, a.typicalSaleMedianEur);
        const savB = calculateCredibleSavings(b.bestPriceEur, b.basePriceEur, b.typicalSaleMedianEur);
        const diff = savB - savA;
        if (diff !== 0) return diff;
      } else if (sort === 'discount') {
        const diff = (b.bestDiscountPercent ?? 0) - (a.bestDiscountPercent ?? 0);
        if (diff !== 0) return diff;
      } else if (sort === 'price') {
        const diff = (a.bestPriceEur ?? 9999) - (b.bestPriceEur ?? 9999);
        if (diff !== 0) return diff;
      } else if (sort === 'rating') {
        const ratingA = a.metacriticScore ?? a.steamReviewPercent ?? 0;
        const ratingB = b.metacriticScore ?? b.steamReviewPercent ?? 0;
        const diff = ratingB - ratingA;
        if (diff !== 0) return diff;
      }
      return (a.priority ?? 999999) - (b.priority ?? 999999);
    });

    const total = games.length;
    const effectiveLimit = Math.max(1, limit);
    const totalPages = Math.max(1, Math.ceil(total / effectiveLimit));
    const offset = (page - 1) * effectiveLimit;
    const paginatedDeals = games.slice(offset, offset + effectiveLimit);

    if (asResultObject) {
      return {
        deals: paginatedDeals,
        total,
        page,
        totalPages
      } as any;
    }

    return paginatedDeals;
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
      bo.voucher_code as best_voucher_code,
      bo.price_event as best_price_event,
      bo.last_observed_at as best_last_observed_at,
      m.name as best_merchant_name,
      m.code as best_merchant_code,
      m.is_official as best_merchant_is_official,
      (SELECT COUNT(DISTINCT source_code) FROM source_observations WHERE offer_id = bo.id) as best_source_agreement_count,
      (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1) as offers_count,
      (SELECT COUNT(*) FROM offers o WHERE o.game_id = g.id AND o.is_likely_pricing_error = 1 AND o.is_valid = 1) as anomaly_count,
      (SELECT MIN(o.price_eur) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1 AND o.is_likely_pricing_error = 0) as market_min_eur,
      (SELECT MAX(o.price_eur) FROM offers o WHERE o.game_id = g.id AND o.is_valid = 1 AND o.is_likely_pricing_error = 0) as market_max_eur,
      (EXISTS (SELECT 1 FROM family_owned_apps fo JOIN profiles fp ON fo.profile_id = fp.id WHERE fp.is_family = 1 AND fo.steam_app_id = g.steam_app_id AND NOT EXISTS (SELECT 1 FROM family_sharing_exclusions fse WHERE fse.steam_app_id = g.steam_app_id))) as is_family_shared,
        (SELECT MAX(ph.recorded_at) FROM price_history ph WHERE ph.game_id = g.id AND ph.is_pricing_error = 0 AND COALESCE(ph.identity_confidence, 'CONFIDENT') != 'AMBIGUOUS' AND ph.price_event NOT IN ('NONE', 'PRICE_INCREASE', 'PRICING_ERROR', 'NEW_OFFER')) as latest_price_drop_at,
      (EXISTS (SELECT 1 FROM family_owned_apps fo JOIN profiles fp ON fo.profile_id = fp.id WHERE fp.is_family = 1 AND fo.steam_app_id = g.steam_app_id AND EXISTS (SELECT 1 FROM family_sharing_exclusions fse WHERE fse.steam_app_id = g.steam_app_id))) as is_family_excluded
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
    if (options.hidePricingErrors) {
      allGames = allGames.filter(g => !g.hasPricingError);
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
      } else if (options.sort === 'price_drops') {
        const dropA = a.latestPriceDropAt ? new Date(a.latestPriceDropAt).getTime() : 0;
        const dropB = b.latestPriceDropAt ? new Date(b.latestPriceDropAt).getTime() : 0;
        if (dropB !== dropA) return dropB - dropA;
        const discA = a.bestDiscountPercent ?? 0;
        const discB = b.bestDiscountPercent ?? 0;
        if (discB !== discA) return discB - discA;
      } else if (options.sort === 'discount_desc') {
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
        g.metacritic_score,
        g.metacritic_url,
        g.price_history_seeded_at,
        g.allkeyshop_last_checked_at,
        g.allkeyshop_check_interval_hours,
        g.allkeyshop_unchanged_streak,
        g.allkeyshop_last_price_eur,
        w.target_price_eur,
        w.priority
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
      metacriticScore: r.metacritic_score !== null && r.metacritic_score !== undefined ? Number(r.metacritic_score) : undefined,
      metacriticUrl: r.metacritic_url || undefined,
      priceHistorySeededAt: r.price_history_seeded_at || undefined,
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
      priority: r.priority !== null && r.priority !== undefined
        ? Number(r.priority)
        : undefined,
    }));
  },

  getUnseededHistoryWishlistGames(profileId: string): WishlistSyncGame[] {
    const rows = prepareStmt(`
      SELECT 
        g.id, 
        g.steam_app_id, 
        g.itad_id, 
        g.title,
        g.release_date,
        g.price_history_seeded_at,
        w.target_price_eur,
        w.priority
      FROM wishlist_entries w
      JOIN games g ON w.game_id = g.id
      WHERE w.profile_id = ? AND w.is_active = 1 AND g.price_history_seeded_at IS NULL
      ORDER BY w.priority ASC
    `).all(profileId) as any[];

    return rows.map(r => ({
      id: r.id,
      steamAppId: Number(r.steam_app_id),
      itadId: r.itad_id || undefined,
      title: r.title,
      releaseDate: r.release_date || undefined,
      priceHistorySeededAt: r.price_history_seeded_at || undefined,
      targetPriceEur: r.target_price_eur !== null && r.target_price_eur !== undefined 
        ? Number(r.target_price_eur) 
        : undefined,
      priority: r.priority !== null && r.priority !== undefined
        ? Number(r.priority)
        : undefined,
    }));
  },

  markPriceHistorySeeded(gameId: string, timestamp?: string): void {
    const ts = timestamp || new Date().toISOString();
    prepareStmt(`UPDATE games SET price_history_seeded_at = ?, updated_at = datetime('now') WHERE id = ?`).run(ts, gameId);
  },

  getStaleWishlistGameIds(profileId: string, ttlHours: number = 6): WishlistSyncGame[] {
    const rows = prepareStmt(`
      SELECT 
        g.id, 
        g.steam_app_id, 
        g.itad_id, 
        g.title,
        g.release_date,
        g.metacritic_score,
        g.metacritic_url,
        g.allkeyshop_last_checked_at,
        g.allkeyshop_check_interval_hours,
        g.allkeyshop_unchanged_streak,
        g.allkeyshop_last_price_eur,
        w.target_price_eur,
        w.priority
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
      metacriticScore: r.metacritic_score !== null && r.metacritic_score !== undefined ? Number(r.metacritic_score) : undefined,
      metacriticUrl: r.metacritic_url || undefined,
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
      priority: r.priority !== null && r.priority !== undefined
        ? Number(r.priority)
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
    reviewDesc?: string;
    reviewsPercent?: number;
    reviewsTotal?: string;
    steamdbRating?: number;
    metacriticScore?: number;
    metacriticUrl?: string;
  }[]): void {
    const db = getDb();
    const now = new Date().toISOString();

    const stmtDeactivate = prepareStmt(`UPDATE wishlist_entries SET is_active = 0 WHERE profile_id = ?`);
    const stmtFindGame = prepareStmt(`SELECT id, title, slug, header_image, base_price_eur FROM games WHERE steam_app_id = ?`);
    const stmtInsertGame = prepareStmt(`
      INSERT INTO games (id, steam_app_id, itad_id, title, slug, header_image, capsule_image, release_date, is_dlc, is_free, base_price_eur, steam_review_desc, steam_review_percent, steam_review_total, steamdb_rating, metacritic_score, metacritic_url, created_at, updated_at)
      VALUES (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        steam_review_desc = COALESCE(?, games.steam_review_desc),
        steam_review_percent = COALESCE(?, games.steam_review_percent),
        steam_review_total = COALESCE(?, games.steam_review_total),
        steamdb_rating = COALESCE(?, games.steamdb_rating),
        metacritic_score = COALESCE(?, games.metacritic_score),
        metacritic_url = COALESCE(?, games.metacritic_url),
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
        const existing = stmtFindGame.get(item.steamAppId) as any;
        const rawTitle = item.title || existing?.title || `Game ${item.steamAppId}`;
        const title = repairMojibake(rawTitle);
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const steamdbRating = item.steamdbRating !== undefined 
          ? item.steamdbRating 
          : (item.reviewsPercent !== undefined && item.reviewsTotal ? calculateSteamDbRating(item.reviewsPercent, item.reviewsTotal) : undefined);
        let gameId: string;

        if (existing) {
          gameId = existing.id;
          stmtUpdateGame.run(
            title,
            slug,
            item.headerImage || null,
            item.capsuleImage || null,
            item.releaseDate || null,
            item.isDlc !== undefined ? (item.isDlc ? 1 : 0) : null,
            item.isFree !== undefined ? (item.isFree ? 1 : 0) : null,
            item.basePriceEur !== undefined ? item.basePriceEur : null,
            item.reviewDesc || null,
            item.reviewsPercent !== undefined ? item.reviewsPercent : null,
            item.reviewsTotal || null,
            steamdbRating !== undefined ? steamdbRating : null,
            item.metacriticScore !== undefined ? item.metacriticScore : null,
            item.metacriticUrl || null,
            now,
            gameId
          );
        } else {
          gameId = randomUUID();
          stmtInsertGame.run(
            gameId,
            item.steamAppId,
            title,
            slug,
            item.headerImage || null,
            item.capsuleImage || null,
            item.releaseDate || null,
            item.isDlc ? 1 : 0,
            item.isFree ? 1 : 0,
            item.basePriceEur !== undefined ? item.basePriceEur : null,
            item.reviewDesc || null,
            item.reviewsPercent !== undefined ? item.reviewsPercent : null,
            item.reviewsTotal || null,
            steamdbRating !== undefined ? steamdbRating : null,
            item.metacriticScore !== undefined ? item.metacriticScore : null,
            item.metacriticUrl || null,
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
        const cleanQuery = repairMojibake(title.trim());
        const exact = prepareStmt(`SELECT id, steam_app_id, title FROM games WHERE LOWER(title) = LOWER(?) OR LOWER(title) = LOWER(?) LIMIT 1`).get(cleanQuery, title.trim()) as any;
        if (exact) {
          resolved.push({
            query: title,
            gameId: exact.id,
            title: exact.title,
            steamAppId: Number(exact.steam_app_id),
            confidence: 1.0
          });
        } else {
          const likeMatch = prepareStmt(`SELECT id, steam_app_id, title FROM games WHERE title LIKE ? OR title LIKE ? LIMIT 1`).get(`%${cleanQuery}%`, `%${title.trim()}%`) as any;
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
  let bestVerdict: DealVerdict | undefined;
  let bestScoreComponents: DealScoreResult['components'] | undefined;
  let bestConfidenceScore: number | undefined;
  let bestConfidenceTier: ConfidenceTier | undefined;
  let bestIsProvisional: boolean | undefined;
  let bestSavingVsMedianEur: number | undefined;
  let bestAtlDistanceEur: number | undefined;
  let valueRankingScore: number | undefined;

  const bestPrice = (r.best_price_eur !== null && r.best_price_eur !== undefined) ? Number(r.best_price_eur) : undefined;
  const rawHistLow = (r.historical_low_eur !== null && r.historical_low_eur !== undefined) ? Number(r.historical_low_eur) : undefined;

  if (bestPrice !== undefined) {
    const isOfficial = r.best_merchant_is_official !== undefined && r.best_merchant_is_official !== null
      ? Boolean(r.best_merchant_is_official)
      : true;

    const isConfirmedAtl = r.atl_is_confirmed !== null && r.atl_is_confirmed !== undefined
      ? Boolean(r.atl_is_confirmed)
      : (r.historical_low_source ? isOfficialStoreSource(r.historical_low_source) : false);
    const isSingleSourceLow = r.atl_is_single_source_low !== null && r.atl_is_single_source_low !== undefined
      ? Boolean(r.atl_is_single_source_low)
      : (r.historical_low_source ? isKeyshopSourceStr(r.historical_low_source) : false);

    const obsTime = r.best_last_observed_at ? new Date(r.best_last_observed_at).getTime() : NaN;
    const daysSinceLastSample = !isNaN(obsTime) ? Math.floor((Date.now() - obsTime) / 86400000) : undefined;

    const isDelisted = isGameDelisted(r.is_delisted, r.base_price_eur ? Number(r.base_price_eur) : null, r.release_date);

    const isUnreleased = isGameUnreleased(r.release_date);

    const dealResult = calculateDealScore({
      priceEur: bestPrice,
      basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
      typicalSaleMedianEur: r.typical_sale_median_eur !== null && r.typical_sale_median_eur !== undefined ? Number(r.typical_sale_median_eur) : null,
      typicalSaleQ1Eur: r.typical_sale_q1_eur !== null && r.typical_sale_q1_eur !== undefined ? Number(r.typical_sale_q1_eur) : undefined,
      typicalSaleQ3Eur: r.typical_sale_q3_eur !== null && r.typical_sale_q3_eur !== undefined ? Number(r.typical_sale_q3_eur) : undefined,
      low90dEur: r.low_90d_eur !== null && r.low_90d_eur !== undefined ? Number(r.low_90d_eur) : null,
      low1yEur: r.low_1y_eur !== null && r.low_1y_eur !== undefined ? Number(r.low_1y_eur) : null,
      officialHistoricalLowEur: r.official_historical_low_eur !== null && r.official_historical_low_eur !== undefined ? Number(r.official_historical_low_eur) : undefined,
      allTimeLowEur: rawHistLow,
      historicalLowEur: rawHistLow,
      isConfirmedAtl,
      isSingleSourceLow,
      sampleCount: r.typical_sale_sample_count !== null && r.typical_sale_sample_count !== undefined ? Number(r.typical_sale_sample_count) : undefined,
      firstObservedAt: r.price_tracking_first_observed_at || undefined,
      lastObservedAt: r.best_last_observed_at || r.last_observed_at || undefined,
      sourceCount: r.best_offer_source_count !== null && r.best_offer_source_count !== undefined
        ? Number(r.best_offer_source_count)
        : undefined,
      offersCount: Number(r.offers_count || 0) || undefined,
      minOfferEur: r.market_min_eur != null ? Number(r.market_min_eur) : undefined,
      maxOfferEur: r.market_max_eur != null ? Number(r.market_max_eur) : undefined,
      daysSinceLastSample,
      isOfficialStore: Boolean(r.best_merchant_is_official),
      isDelisted,
      isUnreleased
    });

    bestDealScore = dealResult.score;
    bestDealTier = dealResult.tier;
    bestVerdict = dealResult.verdict;
    bestScoreComponents = dealResult.components;
    bestConfidenceScore = dealResult.confidenceScore;
    bestConfidenceTier = dealResult.confidenceTier;
    bestIsProvisional = dealResult.isProvisional;
    bestSavingVsMedianEur = dealResult.explanation?.medianSavingEur;
    bestAtlDistanceEur = dealResult.explanation?.atlDistanceEur;
    // Value Ranking Score for discovery: monotonic combination of deal score and confidence
    valueRankingScore = Number((dealResult.score * (0.65 + 0.35 * (dealResult.confidenceScore / 100))).toFixed(1));
  }

  let shoppingScore: number | undefined;
  if (bestDealScore !== undefined && bestPrice !== undefined) {
    const isStandardSteam = (!r.best_edition_key || r.best_edition_key === 'standard') &&
                            (!r.best_activation_platform || r.best_activation_platform === 'steam');

    // Only standard edition on steam matches the canonical games.historical_low_eur.
    // Non-standard editions or alternate platforms cannot contaminate or be contaminated by standard Steam ATL.
    // Official retailer offers compare against official_historical_low_eur to prevent keyshop dumps from contaminating official deals.
    const relevantAtl = isStandardSteam
      ? (r.best_merchant_is_official && r.official_historical_low_eur && Number(r.official_historical_low_eur) > 0
          ? Number(r.official_historical_low_eur)
          : rawHistLow)
      : undefined;

    shoppingScore = calculateShoppingScore({
      dealScore: bestDealScore,
      currentPriceEur: bestPrice,
      basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
      typicalSaleMedianEur: r.typical_sale_median_eur !== null && r.typical_sale_median_eur !== undefined ? Number(r.typical_sale_median_eur) : undefined,
      historicalLowEur: relevantAtl,
      competingPriceEur: r.alternative_offer_price_eur !== null && r.alternative_offer_price_eur !== undefined ? Number(r.alternative_offer_price_eur) : undefined,
      confidenceScore: bestConfidenceScore
    });
  }

  let actionSignal: ActionSignal | undefined = undefined;
  if (bestPrice !== undefined && bestDealScore !== undefined) {
    actionSignal = generateActionSignal({
      dealScore: bestDealScore,
      confidenceScore: bestConfidenceScore ?? 50,
      isProvisional: Boolean(bestIsProvisional),
      isAnomaly: Boolean(r.anomaly_count && Number(r.anomaly_count) > 0),
      currentPriceEur: bestPrice,
      basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
      typicalSaleMedianEur: r.typical_sale_median_eur !== null && r.typical_sale_median_eur !== undefined ? Number(r.typical_sale_median_eur) : undefined,
      typicalSaleQ1Eur: r.typical_sale_q1_eur !== null && r.typical_sale_q1_eur !== undefined ? Number(r.typical_sale_q1_eur) : undefined,
      typicalSaleQ3Eur: r.typical_sale_q3_eur !== null && r.typical_sale_q3_eur !== undefined ? Number(r.typical_sale_q3_eur) : undefined,
      typicalSaleSampleCount: r.typical_sale_sample_count !== null && r.typical_sale_sample_count !== undefined ? Number(r.typical_sale_sample_count) : undefined,
      historicalLowEur: rawHistLow,
      low90dEur: r.low_90d_eur !== null && r.low_90d_eur !== undefined ? Number(r.low_90d_eur) : undefined
    });
  }

  return {
    id: r.id,
    steamAppId: Number(r.steam_app_id),
    itadId: r.itad_id || undefined,
    nexardaId: r.nexarda_id !== null && r.nexarda_id !== undefined ? Number(r.nexarda_id) : undefined,
    title: r.title,
    slug: r.slug,
    headerImage: r.header_image || undefined,
    capsuleImage: r.capsule_image || undefined,
    iconUrl: r.icon_url || undefined,
    releaseDate: r.release_date || undefined,
    isDlc: Boolean(r.is_dlc),
    isFree: Boolean(r.is_free),
    isFamilyShared: Boolean(r.is_family_shared),
    isFamilyExcluded: Boolean(r.is_family_excluded),
    basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
    historicalLowEur: rawHistLow,
    historicalLowDate: r.historical_low_date || undefined,
    historicalLowSource: r.historical_low_source || undefined,
    officialHistoricalLowEur: r.official_historical_low_eur !== null && r.official_historical_low_eur !== undefined ? Number(r.official_historical_low_eur) : undefined,
    officialHistoricalLowDate: r.official_historical_low_date || undefined,
    officialHistoricalLowSource: r.official_historical_low_source || undefined,
    saleCadence: r.sale_cadence || undefined,
    avgDaysBetweenSales: r.avg_days_between_sales !== null && r.avg_days_between_sales !== undefined ? Number(r.avg_days_between_sales) : undefined,
    daysSinceLastSale: r.days_since_last_sale !== null && r.days_since_last_sale !== undefined ? Number(r.days_since_last_sale) : undefined,
    subscriptionServices: r.subscription_services 
      ? r.subscription_services.split(',').filter(Boolean)
      : ((!r.subscription_services && r.steam_app_id) ? (getGameSubscriptions(Number(r.steam_app_id), r.title).length > 0 ? getGameSubscriptions(Number(r.steam_app_id), r.title) : undefined) : undefined),
    latestPriceDropAt: r.latest_price_drop_at || undefined,
    steamReviewDesc: r.steam_review_desc || undefined,
    steamReviewPercent: r.steam_review_percent !== null && r.steam_review_percent !== undefined ? Number(r.steam_review_percent) : undefined,
    steamReviewTotal: r.steam_review_total || undefined,
    steamdbRating: r.steamdb_rating !== null && r.steamdb_rating !== undefined ? Number(r.steamdb_rating) : undefined,
    metacriticScore: r.metacritic_score !== null && r.metacritic_score !== undefined ? Number(r.metacritic_score) : undefined,
    metacriticUrl: r.metacritic_url || undefined,
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
    bestVoucherCode: r.best_voucher_code || undefined,
    bestOfferId: r.best_offer_id || undefined,
    bestPriceEvent: r.best_price_event || undefined,
    bestLastObservedAt: r.best_last_observed_at || r.last_observed_at || undefined,
    bestIsFresh: r.best_price_eur !== null && r.best_price_eur !== undefined
      ? (!isNaN(new Date(r.best_last_observed_at || r.last_observed_at || '').getTime()) &&
         (Date.now() - new Date(r.best_last_observed_at || r.last_observed_at || '').getTime()) <= FRESHNESS_WINDOW_MS)
      : undefined,
    bestDealScore,
    bestDealTier,
    bestVerdict,
    bestScoreComponents,
    bestConfidenceScore,
    bestConfidenceTier,
    bestIsProvisional,
    bestSavingVsMedianEur,
    bestAtlDistanceEur,
    valueRankingScore,
    shoppingScore,
    alternativeOfferPriceEur: r.alternative_offer_price_eur !== null && r.alternative_offer_price_eur !== undefined ? Number(r.alternative_offer_price_eur) : undefined,
    alternativeMerchantName: r.alternative_merchant_name || undefined,
    alternativeMerchantIsOfficial: r.alternative_merchant_is_official !== null && r.alternative_merchant_is_official !== undefined ? Boolean(r.alternative_merchant_is_official) : undefined,
    actionSignal,
    hasPricingError: Number(r.anomaly_count || 0) > 0,
    pricingErrorCount: Number(r.anomaly_count || 0),
    offersCount: Number(r.offers_count || 0),
    priority: r.priority !== undefined ? Number(r.priority) : undefined,
    dateAddedSteam: r.date_added_steam || undefined,
    targetPriceEur: r.target_price_eur !== null && r.target_price_eur !== undefined ? Number(r.target_price_eur) : undefined,
    allkeyshopLastCheckedAt: r.allkeyshop_last_checked_at || undefined,
    allkeyshopCheckIntervalHours: r.allkeyshop_check_interval_hours !== null && r.allkeyshop_check_interval_hours !== undefined ? Number(r.allkeyshop_check_interval_hours) : undefined,
    allkeyshopUnchangedStreak: r.allkeyshop_unchanged_streak !== null && r.allkeyshop_unchanged_streak !== undefined ? Number(r.allkeyshop_unchanged_streak) : undefined,
    allkeyshopLastPriceEur: r.allkeyshop_last_price_eur !== null && r.allkeyshop_last_price_eur !== undefined ? Number(r.allkeyshop_last_price_eur) : undefined,
    priceHistorySeededAt: r.price_history_seeded_at || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
