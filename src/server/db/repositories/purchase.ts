import { randomUUID } from 'crypto';
import { prepareStmt } from '../core.js';
import type { Purchase, SavingsSummary, MonthlySavings } from '../../../shared/types.js';

export interface RecordPurchaseParams {
  profileId: string;
  gameId: string;
  offerId?: string;
  merchantId?: string;
  priceEur: number;
  purchasedAt?: string;
  notes?: string;
}

export const purchaseRepo = {
  record(params: RecordPurchaseParams): Purchase {
    const id = randomUUID();
    const now = new Date().toISOString();
    const purchasedAt = params.purchasedAt || now;

    // 1. Fetch snapshot of game MSRP (base_price_eur) and typical sale median
    const game = prepareStmt(`
      SELECT base_price_eur, typical_sale_median_eur 
      FROM games 
      WHERE id = ?
    `).get(params.gameId) as any;

    let merchantId = params.merchantId;
    if (!merchantId && params.offerId) {
      const offer = prepareStmt(`SELECT merchant_id FROM offers WHERE id = ?`).get(params.offerId) as any;
      if (offer?.merchant_id) {
        merchantId = offer.merchant_id;
      }
    }

    const msrp = game?.base_price_eur != null && !isNaN(Number(game.base_price_eur)) ? Number(game.base_price_eur) : undefined;
    const median = game?.typical_sale_median_eur != null && !isNaN(Number(game.typical_sale_median_eur)) ? Number(game.typical_sale_median_eur) : undefined;

    const savingsVsMsrp = msrp !== undefined ? Math.max(0, Math.round((msrp - params.priceEur) * 100) / 100) : 0;
    const savingsVsMedian = median !== undefined ? Math.max(0, Math.round((median - params.priceEur) * 100) / 100) : 0;

    prepareStmt(`
      INSERT INTO purchases (
        id, profile_id, game_id, offer_id, merchant_id, 
        price_eur, msrp_eur, typical_median_eur, 
        savings_vs_msrp_eur, savings_vs_median_eur, 
        purchased_at, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.profileId,
      params.gameId,
      params.offerId || null,
      merchantId || null,
      params.priceEur,
      msrp ?? null,
      median ?? null,
      savingsVsMsrp,
      savingsVsMedian,
      purchasedAt,
      params.notes || null,
      now
    );

    return this.getById(id)!;
  },

  getById(id: string): Purchase | null {
    const row = prepareStmt(`
      SELECT 
        p.*,
        g.title as game_title,
        g.steam_app_id,
        m.name as merchant_name,
        pr.name as profile_name
      FROM purchases p
      LEFT JOIN games g ON p.game_id = g.id
      LEFT JOIN merchants m ON p.merchant_id = m.id
      LEFT JOIN profiles pr ON p.profile_id = pr.id
      WHERE p.id = ?
    `).get(id) as any;

    if (!row) return null;
    return this.mapRow(row);
  },

  list(profileId?: string): Purchase[] {
    const sql = profileId
      ? `SELECT 
           p.*,
           g.title as game_title,
           g.steam_app_id,
           m.name as merchant_name,
           pr.name as profile_name
         FROM purchases p
         LEFT JOIN games g ON p.game_id = g.id
         LEFT JOIN merchants m ON p.merchant_id = m.id
         LEFT JOIN profiles pr ON p.profile_id = pr.id
         WHERE p.profile_id = ?
         ORDER BY p.purchased_at DESC`
      : `SELECT 
           p.*,
           g.title as game_title,
           g.steam_app_id,
           m.name as merchant_name,
           pr.name as profile_name
         FROM purchases p
         LEFT JOIN games g ON p.game_id = g.id
         LEFT JOIN merchants m ON p.merchant_id = m.id
         LEFT JOIN profiles pr ON p.profile_id = pr.id
         ORDER BY p.purchased_at DESC`;

    const rows = profileId ? prepareStmt(sql).all(profileId) as any[] : prepareStmt(sql).all() as any[];
    return rows.map(r => this.mapRow(r));
  },

  delete(id: string): boolean {
    const res = prepareStmt(`DELETE FROM purchases WHERE id = ?`).run(id);
    return res.changes > 0;
  },

  getSavingsSummary(profileId?: string): SavingsSummary {
    // Overall totals
    const totalRow = (profileId
      ? prepareStmt(`
          SELECT 
            COUNT(id) as total_purchases,
            SUM(price_eur) as total_spent,
            SUM(savings_vs_msrp_eur) as total_saved_msrp,
            SUM(savings_vs_median_eur) as total_saved_median
          FROM purchases
          WHERE profile_id = ?
        `).get(profileId)
      : prepareStmt(`
          SELECT 
            COUNT(id) as total_purchases,
            SUM(price_eur) as total_spent,
            SUM(savings_vs_msrp_eur) as total_saved_msrp,
            SUM(savings_vs_median_eur) as total_saved_median
          FROM purchases
        `).get()
    ) as any;

    // Monthly breakdown
    const monthlyRows = (profileId
      ? prepareStmt(`
          SELECT 
            strftime('%Y-%m', purchased_at) as month,
            COUNT(id) as count,
            SUM(price_eur) as spent_eur,
            SUM(savings_vs_msrp_eur) as saved_vs_msrp_eur,
            SUM(savings_vs_median_eur) as saved_vs_median_eur
          FROM purchases
          WHERE profile_id = ?
          GROUP BY strftime('%Y-%m', purchased_at)
          ORDER BY month DESC
        `).all(profileId)
      : prepareStmt(`
          SELECT 
            strftime('%Y-%m', purchased_at) as month,
            COUNT(id) as count,
            SUM(price_eur) as spent_eur,
            SUM(savings_vs_msrp_eur) as saved_vs_msrp_eur,
            SUM(savings_vs_median_eur) as saved_vs_median_eur
          FROM purchases
          GROUP BY strftime('%Y-%m', purchased_at)
          ORDER BY month DESC
        `).all()
    ) as any[];

    const monthly: MonthlySavings[] = monthlyRows.map(r => ({
      month: r.month || 'Unknown',
      count: Number(r.count || 0),
      spentEur: Math.round(Number(r.spent_eur || 0) * 100) / 100,
      savedVsMsrpEur: Math.round(Number(r.saved_vs_msrp_eur || 0) * 100) / 100,
      savedVsMedianEur: Math.round(Number(r.saved_vs_median_eur || 0) * 100) / 100
    }));

    return {
      totalPurchases: Number(totalRow?.total_purchases || 0),
      totalSpentEur: Math.round(Number(totalRow?.total_spent || 0) * 100) / 100,
      totalSavedVsMsrpEur: Math.round(Number(totalRow?.total_saved_msrp || 0) * 100) / 100,
      totalSavedVsMedianEur: Math.round(Number(totalRow?.total_saved_median || 0) * 100) / 100,
      monthly
    };
  },

  mapRow(r: any): Purchase {
    return {
      id: r.id,
      profileId: r.profile_id,
      profileName: r.profile_name || undefined,
      gameId: r.game_id,
      gameTitle: r.game_title || 'Unknown Game',
      steamAppId: r.steam_app_id ? Number(r.steam_app_id) : undefined,
      offerId: r.offer_id || undefined,
      merchantId: r.merchant_id || undefined,
      merchantName: r.merchant_name || undefined,
      priceEur: Number(r.price_eur),
      msrpEur: r.msrp_eur != null ? Number(r.msrp_eur) : undefined,
      typicalMedianEur: r.typical_median_eur != null ? Number(r.typical_median_eur) : undefined,
      savingsVsMsrpEur: Number(r.savings_vs_msrp_eur || 0),
      savingsVsMedianEur: Number(r.savings_vs_median_eur || 0),
      purchasedAt: r.purchased_at,
      notes: r.notes || undefined,
      createdAt: r.created_at
    };
  }
};
