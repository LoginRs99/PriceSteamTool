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

  it('handles targetReachedOnly filter correctly', () => {
    const { whereSql, params } = buildWishlistFilterClause('profile-tgt', {
      targetReachedOnly: true
    });

    expect(whereSql).toContain('w.target_price_eur IS NOT NULL');
    expect(whereSql).toContain('bo.price_eur <= w.target_price_eur');
    expect(params).toEqual(['profile-tgt']);
  });

  it('handles hideUnreleased filter correctly', () => {
    const { whereSql, params } = buildWishlistFilterClause('profile-rel', {
      hideUnreleased: true
    });

    expect(whereSql).toContain('bo.price_eur IS NOT NULL AND bo.price_eur > 0');
    expect(whereSql).toContain("LOWER(g.release_date) NOT LIKE '%coming soon%'");
    expect(params).toEqual(['profile-rel']);
  });

  it('handles hideDlcs filter correctly', () => {
    const { whereSql, params } = buildWishlistFilterClause('profile-dlc', {
      hideDlcs: true
    });

    expect(whereSql).toContain('(g.is_dlc = 0 OR g.is_dlc IS NULL)');
    expect(params).toEqual(['profile-dlc']);
  });

  it('handles includeFreeGames filter correctly without excluding free games', () => {
    const { whereSql, params } = buildWishlistFilterClause('profile-all', {
      includeFreeGames: true
    });

    expect(whereSql).not.toContain('(g.is_free = 0 OR g.is_free IS NULL)');
    expect(whereSql).not.toContain('(g.is_free = 1 OR g.base_price_eur = 0)');
    expect(params).toEqual(['profile-all']);
  });

  it('handles hideFamilyShared filter correctly by checking family_owned_apps and profiles', () => {
    const { whereSql, params } = buildWishlistFilterClause('profile-fam', {
      hideFamilyShared: true
    });

    expect(whereSql).toContain('NOT EXISTS');
    expect(whereSql).toContain('family_owned_apps fo');
    expect(whereSql).toContain('fp.is_family = 1');
    expect(whereSql).toContain('fo.steam_app_id = g.steam_app_id');
    expect(params).toEqual(['profile-fam']);
  });

  it('handles steamAppId filter correctly', () => {
    const { whereSql, params } = buildWishlistFilterClause('profile-steam', {
      steamAppId: 1091500
    });

    expect(whereSql).toContain('g.steam_app_id = ?');
    expect(params).toEqual(['profile-steam', 1091500]);
  });
});
