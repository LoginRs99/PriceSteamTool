import { randomUUID } from 'crypto';
import { prepareStmt } from '../core.js';
import type { PricingError } from '../../../shared/types.js';
import { logWarn } from '../../utils/logger.js';

export const PRICING_ERROR_RETRIGGER_AFTER_DAYS = 30;

export const pricingErrorRepo = {
  record(
    gameId: string, 
    offerId: string, 
    type: string, 
    confidence: number, 
    reason: string, 
    currentPriceEur?: number,
    previousPriceEur?: number
  ): boolean {
    const now = new Date().toISOString();
    
    // 1. Check if an active (non-dismissed) pricing error record exists for this game
    const activeGameError = prepareStmt(`
      SELECT pe.id, pe.offer_id, o.price_eur
      FROM pricing_errors pe
      LEFT JOIN offers o ON pe.offer_id = o.id
      WHERE pe.game_id = ? AND pe.is_dismissed = 0
    `).get(gameId) as any;

    if (activeGameError) {
      const activePrice = activeGameError.price_eur !== null && activeGameError.price_eur !== undefined
        ? Number(activeGameError.price_eur)
        : Infinity;
      const newPrice = currentPriceEur ?? Infinity;

      if (activeGameError.offer_id === offerId) {
        // Update active pricing error record in-place for same offer
        prepareStmt(`
          UPDATE pricing_errors
          SET confidence = ?, reason = ?, error_type = ?, detected_at = ?
          WHERE id = ?
        `).run(confidence, reason, type, now, activeGameError.id);
        prepareStmt(`UPDATE offers SET is_likely_pricing_error = 1 WHERE id = ?`).run(offerId);
        return true;
      } else if (newPrice < activePrice - 0.005) {
        // New offer is a cheaper / primary deal pricing error -> replace the existing active game pricing error
        prepareStmt(`
          UPDATE pricing_errors
          SET offer_id = ?, confidence = ?, reason = ?, error_type = ?, detected_at = ?
          WHERE id = ?
        `).run(offerId, confidence, reason, type, now, activeGameError.id);
        prepareStmt(`UPDATE offers SET is_likely_pricing_error = 1 WHERE id = ?`).run(offerId);
        return true;
      } else {
        // Existing active pricing error is cheaper -> do not create duplicate secondary pricing error row
        prepareStmt(`UPDATE offers SET is_likely_pricing_error = 1 WHERE id = ?`).run(offerId);
        return true;
      }
    }

    // 2. Check if a dismissed pricing error record exists for this offer
    const dismissedExisting = prepareStmt(`
      SELECT id, error_type, confidence, detected_at
      FROM pricing_errors
      WHERE game_id = ? AND offer_id = ? AND is_dismissed = 1
      ORDER BY detected_at DESC LIMIT 1
    `).get(gameId, offerId) as any;

    if (dismissedExisting) {
      const isSameType = (dismissedExisting.error_type === type) ||
        (dismissedExisting.error_type === 'DECIMAL_SHIFT' && type === 'SUB_EURO_PREMIUM_GLITCH') ||
        (dismissedExisting.error_type === 'SUB_EURO_PREMIUM_GLITCH' && type === 'DECIMAL_SHIFT');
      const isPriceDrop = (previousPriceEur !== undefined && currentPriceEur !== undefined && currentPriceEur < previousPriceEur - 0.005);

      let isExpiredDismissal = false;
      if (dismissedExisting.detected_at) {
        const detectedTime = new Date(dismissedExisting.detected_at).getTime();
        if (!isNaN(detectedTime)) {
          const ageDays = (Date.now() - detectedTime) / (1000 * 60 * 60 * 24);
          if (ageDays >= PRICING_ERROR_RETRIGGER_AFTER_DAYS) {
            isExpiredDismissal = true;
          }
        }
      }

      if (isSameType && !isPriceDrop && !isExpiredDismissal) {
        // Materially unchanged event within 30 days -> respect dismissal and do NOT create new active row
        prepareStmt(`UPDATE offers SET is_likely_pricing_error = 0 WHERE id = ?`).run(offerId);
        return false;
      }
    }

    // 3. New active pricing error event (first-time detection, post-resolution, price drop, or type change)
    const id = randomUUID();
    prepareStmt(`
      INSERT INTO pricing_errors (id, game_id, offer_id, error_type, confidence, reason, detected_at, is_dismissed)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(id, gameId, offerId, type, confidence, reason, now);
    prepareStmt(`UPDATE offers SET is_likely_pricing_error = 1 WHERE id = ?`).run(offerId);

    if (confidence >= 0.60) {
      try {
        const gameRow = prepareStmt(`SELECT title FROM games WHERE id = ?`).get(gameId) as any;
        const merchantRow = prepareStmt(`
          SELECT m.name FROM offers o LEFT JOIN merchants m ON o.merchant_id = m.id WHERE o.id = ?
        `).get(offerId) as any;
        const gTitle = gameRow?.title || 'Game';
        const mName = merchantRow?.name || 'Store';
        const pStr = currentPriceEur !== undefined ? `€${currentPriceEur.toFixed(2)}` : 'N/A';
        logWarn(`Pricing Error Detected | game="${gTitle}" | store="${mName}" | price="${pStr}" | type="${type}" | confidence=${confidence.toFixed(2)}`);
      } catch (e) {
        // Suppress logging error
      }
    }
    return true;
  },

  resolveForOffer(offerId: string): void {
    // When an offer price returns to normal (isLikelyPricingError === false), resolve active pricing error record
    prepareStmt(`
      UPDATE pricing_errors 
      SET is_dismissed = 1 
      WHERE offer_id = ? AND is_dismissed = 0
    `).run(offerId);
    prepareStmt(`UPDATE offers SET is_likely_pricing_error = 0 WHERE id = ?`).run(offerId);
  },

  list(onlyActive: boolean = true): PricingError[] {
    const sql = onlyActive 
      ? `SELECT pe.*, o.price_eur, o.original_price_eur, o.deal_url, g.title as game_title, g.steam_app_id, m.name as merchant_name, m.default_url as merchant_default_url 
         FROM pricing_errors pe 
         LEFT JOIN games g ON pe.game_id = g.id
         LEFT JOIN offers o ON pe.offer_id = o.id
         LEFT JOIN merchants m ON o.merchant_id = m.id
         WHERE pe.is_dismissed = 0 
           AND o.is_likely_pricing_error = 1 
           AND o.is_valid = 1
           AND (o.price_event IS NULL OR o.price_event != 'PRICE_INCREASE')
           AND NOT EXISTS (
             SELECT 1 FROM offers o2 
             WHERE o2.game_id = pe.game_id 
               AND o2.id != o.id 
               AND o2.is_valid = 1 
               AND o2.price_eur < o.price_eur - 0.01
           )
         ORDER BY pe.detected_at DESC`
      : `SELECT pe.*, o.price_eur, o.original_price_eur, o.deal_url, g.title as game_title, g.steam_app_id, m.name as merchant_name, m.default_url as merchant_default_url 
         FROM pricing_errors pe 
         LEFT JOIN games g ON pe.game_id = g.id
         LEFT JOIN offers o ON pe.offer_id = o.id
         LEFT JOIN merchants m ON o.merchant_id = m.id
         ORDER BY pe.detected_at DESC`;

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
        errorType: r.error_type || 'PRICE_GLITCH',
        confidence: Number(r.confidence || 0),
        reason: r.reason || 'Flagged price error',
        detectedAt: r.detected_at || new Date().toISOString(),
        isDismissed: Boolean(r.is_dismissed)
      };
    });
  },

  dismiss(id: string): string | undefined {
    const errorRow = prepareStmt(`SELECT offer_id, game_id FROM pricing_errors WHERE id = ?`).get(id) as any;
    prepareStmt(`UPDATE pricing_errors SET is_dismissed = 1 WHERE id = ?`).run(id);
    if (errorRow?.offer_id) {
      prepareStmt(`UPDATE offers SET is_likely_pricing_error = 0 WHERE id = ?`).run(errorRow.offer_id);
    }
    return errorRow?.game_id;
  },

  dismissAll(): void {
    prepareStmt(`UPDATE pricing_errors SET is_dismissed = 1 WHERE is_dismissed = 0`).run();
    prepareStmt(`UPDATE offers SET is_likely_pricing_error = 0 WHERE is_likely_pricing_error = 1`).run();
  }
};

// Compatibility aliases
export const anomalyRepo = pricingErrorRepo;
export const ANOMALY_RETRIGGER_AFTER_DAYS = PRICING_ERROR_RETRIGGER_AFTER_DAYS;

