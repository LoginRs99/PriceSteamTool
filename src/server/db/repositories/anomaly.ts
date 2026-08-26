import { randomUUID } from 'crypto';
import { prepareStmt } from '../core.js';
import type { Anomaly } from '../../../shared/types.js';

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
