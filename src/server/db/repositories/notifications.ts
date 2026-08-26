import { randomUUID } from 'crypto';
import { prepareStmt } from '../core.js';

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
