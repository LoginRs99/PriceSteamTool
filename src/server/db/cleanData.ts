import { getDb, prepareStmt, BEST_DEAL_RECOMPUTE_ALL_SQL } from './core.js';
import { logInfo } from '../utils/logger.js';

export interface CleanupResult {
  deletedOffers: number;
  updatedGames: number;
  resolvedPricingErrors?: number;
  unflaggedOffers?: number;
}

export function purgeCorruptedPricingErrors(): { resolvedPricingErrors: number; unflaggedOffers: number } {
  const db = getDb();
  let resolvedPricingErrors = 0;
  let unflaggedOffers = 0;

  db.transaction(() => {
    // 1. Resolve SOURCE_FAMILY_CONFLICT false positives:
    // a) Official store offers (official stores are authorized publisher retailers, never glitches from keyshop spreads)
    // b) Offers corroborated by other active valid offers (within 25% or €1.50)
    // c) Offers where price > 1.005 and either at/above known ATL or official peer ratio is < 12.0x
    const sfcToResolve = prepareStmt(`
      SELECT pe.id, pe.offer_id
      FROM pricing_errors pe
      JOIN offers o ON pe.offer_id = o.id
      JOIN games g ON pe.game_id = g.id
      JOIN merchants m ON o.merchant_id = m.id
      WHERE pe.is_dismissed = 0
        AND pe.error_type = 'SOURCE_FAMILY_CONFLICT'
        AND (
          m.is_official = 1
          OR EXISTS (
            SELECT 1 FROM offers p
            WHERE p.game_id = o.game_id AND p.id != o.id AND p.is_valid = 1 AND p.price_eur > 0
              AND (abs(p.price_eur - o.price_eur) / o.price_eur <= 0.25 OR abs(p.price_eur - o.price_eur) <= 1.50)
          )
          OR (
            o.price_eur > 1.005 
            AND (
              (g.historical_low_eur IS NOT NULL AND g.historical_low_eur > 0 AND o.price_eur >= g.historical_low_eur - 0.05)
              OR (
                SELECT COALESCE(MIN(p.price_eur), 999999)
                FROM offers p
                JOIN merchants m2 ON p.merchant_id = m2.id
                WHERE p.game_id = o.game_id AND m2.is_official = 1 AND p.is_valid = 1
              ) < 12.0 * o.price_eur
            )
          )
        )
    `).all() as { id: string; offer_id: string }[];

    // 2. Resolve FAKE_BASELINE false positives:
    // When selling at or above Steam base price (e.g. Deluxe/Complete bundles) or on official stores
    const fbToResolve = prepareStmt(`
      SELECT pe.id, pe.offer_id
      FROM pricing_errors pe
      JOIN offers o ON pe.offer_id = o.id
      JOIN games g ON pe.game_id = g.id
      JOIN merchants m ON o.merchant_id = m.id
      WHERE pe.is_dismissed = 0
        AND pe.error_type = 'FAKE_BASELINE'
        AND (
          m.is_official = 1
          OR o.price_eur >= COALESCE(g.base_price_eur, 0)
        )
    `).all() as { id: string; offer_id: string }[];

    // 3. Resolve MARKET_OUTLIER false positives:
    // Offers that do not satisfy the 0.55 threshold (< min_peer * 0.55) or gap < 2.00, or official stores
    const moToResolve = prepareStmt(`
      SELECT pe.id, pe.offer_id
      FROM pricing_errors pe
      JOIN offers o ON pe.offer_id = o.id
      JOIN merchants m ON o.merchant_id = m.id
      WHERE pe.is_dismissed = 0
        AND pe.error_type = 'MARKET_OUTLIER'
        AND (
          m.is_official = 1
          OR o.price_eur >= 0.55 * COALESCE((
            SELECT MIN(p.price_eur) FROM offers p
            WHERE p.game_id = o.game_id AND p.id != o.id AND p.is_valid = 1 AND p.price_eur > 0
          ), o.price_eur)
          OR COALESCE((
            SELECT MIN(p.price_eur) FROM offers p
            WHERE p.game_id = o.game_id AND p.id != o.id AND p.is_valid = 1 AND p.price_eur > 0
          ), o.price_eur) - o.price_eur < 2.00
        )
    `).all() as { id: string; offer_id: string }[];

    // 4. Resolve DECIMAL_SHIFT false positives:
    // Official store budget sales (>= 0.70 EUR) or corroborated sub-euro offers
    const dsToResolve = prepareStmt(`
      SELECT pe.id, pe.offer_id
      FROM pricing_errors pe
      JOIN offers o ON pe.offer_id = o.id
      JOIN merchants m ON o.merchant_id = m.id
      WHERE pe.is_dismissed = 0
        AND pe.error_type = 'DECIMAL_SHIFT'
        AND (
          (m.is_official = 1 AND o.price_eur >= 0.70)
          OR EXISTS (
            SELECT 1 FROM offers p
            WHERE p.game_id = o.game_id AND p.id != o.id AND p.is_valid = 1 AND p.price_eur > 0
              AND (abs(p.price_eur - o.price_eur) / o.price_eur <= 0.25 OR abs(p.price_eur - o.price_eur) <= 0.50)
          )
        )
    `).all() as { id: string; offer_id: string }[];

    const allToResolve = [...sfcToResolve, ...fbToResolve, ...moToResolve, ...dsToResolve];
    const uniqueErrorIds = Array.from(new Set(allToResolve.map(r => r.id)));
    resolvedPricingErrors = uniqueErrorIds.length;

    if (resolvedPricingErrors > 0) {
      for (const errId of uniqueErrorIds) {
        prepareStmt(`UPDATE pricing_errors SET is_dismissed = 1 WHERE id = ?`).run(errId);
      }

      // Unflag offers that have no active pricing errors remaining
      const unflagged = prepareStmt(`
        UPDATE offers
        SET is_likely_pricing_error = 0,
            pricing_error_confidence = 0.0,
            pricing_error_type = NULL,
            pricing_error_reason = NULL
        WHERE is_likely_pricing_error = 1
          AND id NOT IN (SELECT offer_id FROM pricing_errors WHERE is_dismissed = 0)
      `).run();
      unflaggedOffers = unflagged.changes;

      // Recompute best deals so restored offers become eligible
      if (unflaggedOffers > 0) {
        db.exec(BEST_DEAL_RECOMPUTE_ALL_SQL);
      }
    }
  })();

  if (resolvedPricingErrors > 0 || unflaggedOffers > 0) {
    logInfo(`[Data Safety Cleanup] Resolved ${resolvedPricingErrors} false-positive pricing errors, unflagged ${unflaggedOffers} offers.`);
  }

  return { resolvedPricingErrors, unflaggedOffers };
}

export function purgeCorruptedPrices(): CleanupResult {
  const db = getDb();
  
  let deletedOffers = 0;
  let updatedGames = 0;

  db.transaction(() => {
    // 1. Delete all offers with price_eur <= 0.05 (except 0.00 EUR for free Steam games)
    const steamMerchant = prepareStmt(`SELECT id FROM merchants WHERE code = 'steam'`).get() as { id: string } | undefined;
    const steamMerchantId = steamMerchant?.id;

    const offersToDelete = prepareStmt(`
      SELECT id, game_id FROM offers 
      WHERE price_eur <= 0.05 
        AND (merchant_id != ? OR price_eur > 0)
    `).all(steamMerchantId || '') as { id: string; game_id: string }[];

    deletedOffers = offersToDelete.length;
    if (deletedOffers > 0) {
      const ids = offersToDelete.map(o => o.id);
      for (const id of ids) {
        prepareStmt(`DELETE FROM source_observations WHERE offer_id = ?`).run(id);
        prepareStmt(`DELETE FROM offers WHERE id = ?`).run(id);
      }
    }

    // 2. Reset allkeyshop_last_price_eur for games with invalid <= 0.05 EUR price
    const gamesToClean = prepareStmt(`
      SELECT id FROM games 
      WHERE allkeyshop_last_price_eur IS NOT NULL AND allkeyshop_last_price_eur <= 0.05
    `).all() as { id: string }[];

    updatedGames = gamesToClean.length;
    for (const g of gamesToClean) {
      const validAksOffer = prepareStmt(`
        SELECT MIN(COALESCE(so.observed_price_eur, o.price_eur)) as min_price 
        FROM offers o
        LEFT JOIN source_observations so ON so.offer_id = o.id AND so.source_code = 'allkeyshop'
        WHERE o.game_id = ? AND o.is_valid = 1
          AND (so.source_code = 'allkeyshop' OR o.deal_url LIKE '%allkeyshop.com%')
          AND (so.observed_price_eur > 0.05 OR o.price_eur > 0.05)
      `).get(g.id) as { min_price: number | null } | undefined;

      const newAksPrice = validAksOffer?.min_price ? Number(validAksOffer.min_price) : null;
      prepareStmt(`
        UPDATE games SET allkeyshop_last_price_eur = ? WHERE id = ?
      `).run(newAksPrice, g.id);
    }

    // 3. Recompute best deals if any offers were purged
    if (deletedOffers > 0) {
      db.exec(BEST_DEAL_RECOMPUTE_ALL_SQL);
    }
  })();

  if (deletedOffers > 0 || updatedGames > 0) {
    logInfo(`[Data Cleanup] Purged ${deletedOffers} corrupted offers (<= 0.05 EUR) and reset ${updatedGames} game records.`);
  }

  // Also resolve legacy false-positive pricing errors
  const errClean = purgeCorruptedPricingErrors();

  return {
    deletedOffers,
    updatedGames,
    resolvedPricingErrors: errClean.resolvedPricingErrors,
    unflaggedOffers: errClean.unflaggedOffers
  };
}
