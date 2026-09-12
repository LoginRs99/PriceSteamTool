import Database from 'better-sqlite3';
import { config } from '../config/index.js';
import { SCHEMA_SQL, SEED_SOURCES_SQL } from './schema.js';
import { calculateTypicalSalePrice, calculatePeriodLows } from '../domain/priceIntelligence.js';
import { runMigrations } from './migrations.js';
import type { 
  Game, 
  Offer, 
  SourceCode, 
  PriceHistoryEntry 
} from '../../shared/types.js';

import { logInfo } from '../utils/logger.js';
import { FRESHNESS_WINDOW_MS } from '../domain/constants.js';

let dbInstance: Database.Database | null = null;
const stmtCache = new Map<string, Database.Statement>();

const FRESHNESS_WINDOW_HOURS = Math.round(FRESHNESS_WINDOW_MS / (60 * 60 * 1000));

export const BEST_DEAL_RECOMPUTE_ALL_SQL = `
  -- Reset and reassign is_best_deal for all games using canonical freshness and priority (fresh safe lowest > stale > pricing error excluded)
  UPDATE offers SET is_best_deal = 0;
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY game_id
      ORDER BY
        CASE
          WHEN (julianday('now') - julianday(COALESCE(last_observed_at, fetched_at))) * 24 <= ${FRESHNESS_WINDOW_HOURS} THEN 0
          ELSE 1
        END ASC,
        price_eur ASC,
        COALESCE(last_observed_at, fetched_at) DESC
    ) as rn
    FROM offers
    WHERE is_valid = 1 AND is_likely_pricing_error = 0
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

    // Run versioned schema migrations
    runMigrations(dbInstance);

    // Auto-resolve historical pricing errors that are price increases or no longer bottom outliers
    try {
      dbInstance.exec(`
        UPDATE pricing_errors 
        SET is_dismissed = 1 
        WHERE is_dismissed = 0 AND (
          offer_id IN (
            SELECT id FROM offers 
            WHERE price_event = 'PRICE_INCREASE' 
               OR is_likely_pricing_error = 0 
               OR is_valid = 0
          )
          OR offer_id IN (
            SELECT o1.id FROM offers o1
            JOIN offers o2 ON o1.game_id = o2.game_id AND o1.id != o2.id
            WHERE o2.is_valid = 1 AND o2.price_eur < o1.price_eur - 0.01
          )
        );
      `);
    } catch {}

    // Diagnostic: audit pricing_errors table content summary at startup
    if (process.env.NODE_ENV !== 'test') {
      try {
        const counts = dbInstance.prepare(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN is_dismissed = 0 THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN is_dismissed = 1 THEN 1 ELSE 0 END) as dismissed
          FROM pricing_errors
        `).get() as any;
        if (counts && counts.total > 0) {
          logInfo(`[Data Safety] Startup pricing errors audit complete | totalEntries=${counts.total} active=${counts.active || 0} dismissed=${counts.dismissed || 0}`);
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

    // Auto-heal any games where active valid offer beats historical_low_eur
    try {
      db.exec(`
        UPDATE games
        SET historical_low_eur = (
          SELECT MIN(o.price_eur)
          FROM offers o
          WHERE o.game_id = games.id AND o.is_valid = 1 AND o.is_likely_pricing_error = 0 AND o.price_eur > 0
        ),
        atl_is_confirmed = (
          SELECT CASE WHEN m.is_official = 1 THEN 1 ELSE 0 END
          FROM offers o
          JOIN merchants m ON o.merchant_id = m.id
          WHERE o.game_id = games.id AND o.is_valid = 1 AND o.is_likely_pricing_error = 0 AND o.price_eur > 0
          ORDER BY o.price_eur ASC, o.id ASC
          LIMIT 1
        ),
        historical_low_source = COALESCE((
          SELECT m.name
          FROM offers o
          JOIN merchants m ON o.merchant_id = m.id
          WHERE o.game_id = games.id AND o.is_valid = 1 AND o.is_likely_pricing_error = 0 AND o.price_eur > 0
          ORDER BY o.price_eur ASC, o.id ASC
          LIMIT 1
        ), games.historical_low_source),
        updated_at = datetime('now')
        WHERE id IN (
          SELECT o.game_id
          FROM offers o
          JOIN games g ON g.id = o.game_id
          WHERE o.is_valid = 1 AND o.is_likely_pricing_error = 0 AND o.price_eur > 0
            AND g.historical_low_eur IS NOT NULL AND g.historical_low_eur > 0
          GROUP BY o.game_id
          HAVING MIN(o.price_eur) < g.historical_low_eur
        );
      `);
    } catch (reconcileErr: any) {
      logInfo(`[Startup] Historical low reconciliation notice: ${reconcileErr.message}`);
    }

    const uncalculatedGames = prepareStmt(`
      SELECT g.id, g.steam_app_id, g.title, g.slug, g.base_price_eur, g.historical_low_eur, g.historical_low_date, g.historical_low_source, g.atl_is_confirmed, g.atl_is_single_source_low, g.is_dlc, g.is_free, g.created_at, g.updated_at
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
          rawPrice: h.raw_price !== null && h.raw_price !== undefined ? Number(h.raw_price) : undefined,
          rawCurrency: h.raw_currency || undefined,
          fxRate: h.fx_rate !== null && h.fx_rate !== undefined ? Number(h.fx_rate) : undefined,
          discountPercent: Number(h.discount_percent || 0),
          priceEvent: h.price_event || 'NONE',
          isPricingError: Boolean(h.is_pricing_error),
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
            isLikelyPricingError: Boolean(bestRow.is_likely_pricing_error),
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
          atlIsConfirmed: g.atl_is_confirmed !== null && g.atl_is_confirmed !== undefined ? Boolean(g.atl_is_confirmed) : undefined,
          atlIsSingleSourceLow: g.atl_is_single_source_low !== null && g.atl_is_single_source_low !== undefined ? Boolean(g.atl_is_single_source_low) : undefined,
          isDlc: Boolean(g.is_dlc),
          isFree: Boolean(g.is_free),
          hasPricingError: false,
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
