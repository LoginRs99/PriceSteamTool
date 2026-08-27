import { randomUUID } from 'crypto';
import { prepareStmt } from '../core.js';
import type { Anomaly } from '../../../shared/types.js';
import { logWarn } from '../../utils/logger.js';

export const anomalyRepo = {
  record(
    gameId: string, 
    offerId: string, 
    type: Anomaly['anomalyType'], 
    score: number, 
    reason: string, 
    currentPriceEur?: number,
    previousPriceEur?: number
  ): void {
    const now = new Date().toISOString();
    
    // 1. Check if an active (non-dismissed) anomaly record exists for this offer
    const activeExisting = prepareStmt(`
      SELECT id FROM anomalies 
      WHERE game_id = ? AND offer_id = ? AND is_dismissed = 0
    `).get(gameId, offerId) as any;

    if (activeExisting) {
      // Update active anomaly record in-place
      prepareStmt(`
        UPDATE anomalies 
        SET score = ?, reason = ?, anomaly_type = ?, detected_at = ? 
        WHERE id = ?
      `).run(score, reason, type, now, activeExisting.id);
      return;
    }

    // 2. Check if a dismissed anomaly record exists for this offer
    const dismissedExisting = prepareStmt(`
      SELECT id, anomaly_type, score
      FROM anomalies
      WHERE game_id = ? AND offer_id = ? AND is_dismissed = 1
      ORDER BY detected_at DESC LIMIT 1
    `).get(gameId, offerId) as any;

    if (dismissedExisting) {
      // Check if this is materially the same ongoing anomaly event that was dismissed:
      // Same anomaly type AND price did not drop further below previous price
      const isSameType = (dismissedExisting.anomaly_type === type);
      const isPriceDrop = (previousPriceEur !== undefined && currentPriceEur !== undefined && currentPriceEur < previousPriceEur - 0.005);

      if (isSameType && !isPriceDrop) {
        // Materially unchanged event -> respect dismissal and do NOT create new active row
        return;
      }
    }

    // 3. New active anomaly event (first-time detection, post-resolution, price drop, or type change)
    const id = randomUUID();
    prepareStmt(`
      INSERT INTO anomalies (id, game_id, offer_id, anomaly_type, score, reason, detected_at, is_dismissed)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(id, gameId, offerId, type, score, reason, now);

    if (score >= 0.60) {
      try {
        const gameRow = prepareStmt(`SELECT title FROM games WHERE id = ?`).get(gameId) as any;
        const merchantRow = prepareStmt(`
          SELECT m.name FROM offers o LEFT JOIN merchants m ON o.merchant_id = m.id WHERE o.id = ?
        `).get(offerId) as any;
        const gTitle = gameRow?.title || 'Game';
        const mName = merchantRow?.name || 'Store';
        const pStr = currentPriceEur !== undefined ? `€${currentPriceEur.toFixed(2)}` : 'N/A';
        logWarn(`Pricing Anomaly Detected | game="${gTitle}" | store="${mName}" | price="${pStr}" | type="${type}" | score=${score.toFixed(2)}`);
      } catch (e) {
        // Suppress logging error
      }
    }
  },

  resolveForOffer(offerId: string): void {
    // When an offer price returns to normal (isAnomaly === false), resolve active anomaly record
    prepareStmt(`
      UPDATE anomalies 
      SET is_dismissed = 1 
      WHERE offer_id = ? AND is_dismissed = 0
    `).run(offerId);
  },

  list(onlyActive: boolean = true): Anomaly[] {
    const sql = onlyActive 
      ? `SELECT a.*, o.price_eur, o.original_price_eur, o.deal_url, g.title as game_title, g.steam_app_id, m.name as merchant_name, m.default_url as merchant_default_url 
         FROM anomalies a 
         LEFT JOIN games g ON a.game_id = g.id
         LEFT JOIN offers o ON a.offer_id = o.id
         LEFT JOIN merchants m ON o.merchant_id = m.id
         WHERE a.is_dismissed = 0 AND (o.is_anomaly = 1 OR o.risk_level = 'HIGH')
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
