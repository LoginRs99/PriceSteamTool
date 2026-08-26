import { describe, it, expect } from 'vitest';
import { buildWishlistFilterClause } from '../../src/server/db/repositories/game.js';

describe('buildWishlistFilterClause Unit Tests', () => {
  it('builds default where clause for profile with active games only', () => {
    const { whereSql, params } = buildWishlistFilterClause('profile-123', {});
    expect(whereSql).toContain('w.profile_id = ?');
    expect(whereSql).toContain('w.is_active = 1');
    expect(whereSql).toContain('(g.is_free = 0 OR g.is_free IS NULL)');
    expect(params).toEqual(['profile-123']);
  });

  it('adds search, minDiscount, maxPrice, and official-only merchant clauses correctly', () => {
    const { whereSql, params } = buildWishlistFilterClause('profile-abc', {
      search: 'witcher',
      minDiscount: 50,
      maxPrice: 20,
      merchantType: 'official',
      majorDealsOnly: true,
      allTimeLowOnly: true
    });

    expect(whereSql).toContain('g.title LIKE ?');
    expect(whereSql).toContain('bo.discount_percent >= ?');
    expect(whereSql).toContain('bo.price_eur <= ?');
    expect(whereSql).toContain('m.is_official = 1');
    expect(whereSql).toContain("bo.price_event IN ('MAJOR_DROP', 'EXTREME_DROP')");
    expect(whereSql).toContain("bo.price_event IN ('NEW_HISTORICAL_LOW', 'AT_HISTORICAL_LOW')");

    expect(params).toEqual(['profile-abc', '%witcher%', 50, 20]);
  });

  it('handles isFreeOnly filter correctly', () => {
    const { whereSql, params } = buildWishlistFilterClause('profile-xyz', {
      isFreeOnly: true
    });

    expect(whereSql).toContain('(g.is_free = 1 OR g.base_price_eur = 0)');
    expect(params).toEqual(['profile-xyz']);
  });
});
