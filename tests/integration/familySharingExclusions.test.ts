import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { getDb, closeDb } from '../../src/server/db/core.js';
import { profileRepo } from '../../src/server/db/repositories/profile.js';
import { gameRepo } from '../../src/server/db/repositories/game.js';
import { steamAdapter } from '../../src/server/sources/steam.js';

function resetDatabase() {
  const db = getDb();
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM family_sharing_exclusions;
    DELETE FROM family_owned_apps;
    DELETE FROM wishlist_entries;
    DELETE FROM games;
    DELETE FROM profiles;
    PRAGMA foreign_keys = ON;
  `);
}

describe('Family Sharing Exclusions Integration (Dragon Age II, Inquisition, Assassin\'s Creed III)', () => {
  const DRAGON_AGE_2_APP_ID = 1238040;
  const DRAGON_AGE_INQ_APP_ID = 1222690;
  const ASSASSINS_CREED_3_APP_ID = 911400;
  const TERRARIA_APP_ID = 105600;

  const mockStoreMetadata: Record<number, { isShareable: boolean; reason?: string; title: string }> = {
    [DRAGON_AGE_2_APP_ID]: {
      isShareable: false,
      reason: 'Requires 3rd-party account (EA Account) - Excluded from Family Sharing',
      title: 'Dragon Age II'
    },
    [DRAGON_AGE_INQ_APP_ID]: {
      isShareable: false,
      reason: 'Requires 3rd-party account (EA Account) - Excluded from Family Sharing',
      title: 'Dragon Age: Inquisition'
    },
    [ASSASSINS_CREED_3_APP_ID]: {
      isShareable: false,
      reason: 'Requires 3rd-party account (Ubisoft Connect) - Excluded from Family Sharing',
      title: "Assassin's Creed III Remastered"
    },
    [TERRARIA_APP_ID]: {
      isShareable: true,
      title: 'Terraria'
    }
  };

  beforeEach(() => {
    resetDatabase();
    vi.spyOn(steamAdapter, 'checkFamilySharingSupport').mockImplementation(async (appId: number) => {
      const entry = mockStoreMetadata[appId];
      if (entry) return entry;
      return { isShareable: true, title: `App ${appId}` };
    });
  });

  afterAll(() => {
    closeDb();
  });

  it('verifies Category 62 detection for DA2, DAI, AC3, and Terraria via steamAdapter', async () => {
    // Check Dragon Age II (EA Launcher, no Category 62)
    const da2Check = await steamAdapter.checkFamilySharingSupport(DRAGON_AGE_2_APP_ID);
    expect(da2Check.isShareable).toBe(false);
    expect(da2Check.reason).toBeDefined();
    expect(da2Check.reason).toMatch(/EA Account|Excluded/i);

    // Check Dragon Age Inquisition (EA Launcher, no Category 62)
    const daiCheck = await steamAdapter.checkFamilySharingSupport(DRAGON_AGE_INQ_APP_ID);
    expect(daiCheck.isShareable).toBe(false);
    expect(daiCheck.reason).toBeDefined();
    expect(daiCheck.reason).toMatch(/EA Account|Excluded/i);

    // Check Assassin's Creed III (Ubisoft Connect, no Category 62)
    const ac3Check = await steamAdapter.checkFamilySharingSupport(ASSASSINS_CREED_3_APP_ID);
    expect(ac3Check.isShareable).toBe(false);
    expect(ac3Check.reason).toBeDefined();
    expect(ac3Check.reason).toMatch(/Ubisoft|Excluded/i);

    // Check Terraria (supports Family Sharing Category 62)
    const terrariaCheck = await steamAdapter.checkFamilySharingSupport(TERRARIA_APP_ID);
    expect(terrariaCheck.isShareable).toBe(true);
  });

  it('correctly demarks unshareable games in wishlist and respects hideFamilyShared filter', () => {
    // 1. Create main user and family member
    const mainUser = profileRepo.create('Gamer', '76561198000000010');
    const familyMember = profileRepo.create('Family Member', '76561198000000011', undefined, undefined, true);

    // 2. Insert test games
    gameRepo.upsert({ steamAppId: DRAGON_AGE_2_APP_ID, title: 'Dragon Age II', basePriceEur: 29.99 });
    gameRepo.upsert({ steamAppId: DRAGON_AGE_INQ_APP_ID, title: 'Dragon Age: Inquisition', basePriceEur: 39.99 });
    gameRepo.upsert({ steamAppId: ASSASSINS_CREED_3_APP_ID, title: "Assassin's Creed III Remastered", basePriceEur: 39.99 });
    gameRepo.upsert({ steamAppId: TERRARIA_APP_ID, title: 'Terraria', basePriceEur: 9.99 });

    // 3. Add all 4 games to main user wishlist
    gameRepo.syncWishlistEntries(mainUser.id, [
      { steamAppId: DRAGON_AGE_2_APP_ID, title: 'Dragon Age II', priority: 1 },
      { steamAppId: DRAGON_AGE_INQ_APP_ID, title: 'Dragon Age: Inquisition', priority: 2 },
      { steamAppId: ASSASSINS_CREED_3_APP_ID, title: "Assassin's Creed III Remastered", priority: 3 },
      { steamAppId: TERRARIA_APP_ID, title: 'Terraria', priority: 4 }
    ]);

    // 4. Family member owns all 4 games
    profileRepo.saveFamilyOwnedApps(familyMember.id, [
      DRAGON_AGE_2_APP_ID,
      DRAGON_AGE_INQ_APP_ID,
      ASSASSINS_CREED_3_APP_ID,
      TERRARIA_APP_ID
    ]);

    // Baseline: before exclusion, all 4 are flagged as isFamilyShared = true
    const initialList = gameRepo.getWishlistGames(mainUser.id);
    expect(initialList.games.every(g => g.isFamilyShared)).toBe(true);
    expect(initialList.games.every(g => !g.isFamilyExcluded)).toBe(true);

    // With hideFamilyShared: true before exclusions, 0 games returned
    const hiddenBefore = gameRepo.getWishlistGames(mainUser.id, { hideFamilyShared: true });
    expect(hiddenBefore.games.length).toBe(0);

    // 5. Exclude DA2, DAI, and AC3 because Steam restricts them
    profileRepo.excludeFamilySharingApp(DRAGON_AGE_2_APP_ID, 'Requires EA Account');
    profileRepo.excludeFamilySharingApp(DRAGON_AGE_INQ_APP_ID, 'Requires EA Account');
    profileRepo.excludeFamilySharingApp(ASSASSINS_CREED_3_APP_ID, 'Requires Ubisoft Connect');

    // Verify exclusions stored
    const exclusions = profileRepo.getFamilySharingExclusions();
    expect(exclusions.length).toBe(3);
    const excludedIds = profileRepo.getFamilySharingExcludedAppIds();
    expect(excludedIds.has(DRAGON_AGE_2_APP_ID)).toBe(true);
    expect(excludedIds.has(DRAGON_AGE_INQ_APP_ID)).toBe(true);
    expect(excludedIds.has(ASSASSINS_CREED_3_APP_ID)).toBe(true);
    expect(excludedIds.has(TERRARIA_APP_ID)).toBe(false);

    // 6. Check wishlist flags after exclusion:
    const listAfterExclusions = gameRepo.getWishlistGames(mainUser.id);
    const da2 = listAfterExclusions.games.find(g => g.steamAppId === DRAGON_AGE_2_APP_ID);
    const dai = listAfterExclusions.games.find(g => g.steamAppId === DRAGON_AGE_INQ_APP_ID);
    const ac3 = listAfterExclusions.games.find(g => g.steamAppId === ASSASSINS_CREED_3_APP_ID);
    const terraria = listAfterExclusions.games.find(g => g.steamAppId === TERRARIA_APP_ID);

    expect(da2?.isFamilyShared).toBe(false);
    expect(da2?.isFamilyExcluded).toBe(true);

    expect(dai?.isFamilyShared).toBe(false);
    expect(dai?.isFamilyExcluded).toBe(true);

    expect(ac3?.isFamilyShared).toBe(false);
    expect(ac3?.isFamilyExcluded).toBe(true);

    expect(terraria?.isFamilyShared).toBe(true);
    expect(terraria?.isFamilyExcluded).toBe(false);

    // 7. Test hideFamilyShared: true filter
    // DA2, DAI, and AC3 MUST be visible now because they are excluded from Family Sharing!
    // Terraria MUST be hidden because it is legitimately shareable.
    const filtered = gameRepo.getWishlistGames(mainUser.id, { hideFamilyShared: true });
    expect(filtered.games.length).toBe(3);
    const filteredAppIds = filtered.games.map(g => g.steamAppId);
    expect(filteredAppIds).toContain(DRAGON_AGE_2_APP_ID);
    expect(filteredAppIds).toContain(DRAGON_AGE_INQ_APP_ID);
    expect(filteredAppIds).toContain(ASSASSINS_CREED_3_APP_ID);
    expect(filteredAppIds).not.toContain(TERRARIA_APP_ID);

    // 8. Restore DA2 (include it back)
    profileRepo.includeFamilySharingApp(DRAGON_AGE_2_APP_ID);
    const listAfterRestore = gameRepo.getWishlistGames(mainUser.id);
    const da2Restored = listAfterRestore.games.find(g => g.steamAppId === DRAGON_AGE_2_APP_ID);
    expect(da2Restored?.isFamilyShared).toBe(true);
    expect(da2Restored?.isFamilyExcluded).toBe(false);
  });

  it('verifies /api/family-sharing/* REST endpoints work properly', async () => {
    const Fastify = (await import('fastify')).default;
    const { apiRoutes } = await import('../../src/server/routes/api.js');
    const app = Fastify();
    await app.register(apiRoutes);
    await app.ready();

    try {
      // 1. Exclude Dragon Age 2 via POST /api/family-sharing/exclude
      const excludeRes = await app.inject({
        method: 'POST',
        url: '/api/family-sharing/exclude',
        payload: {
          steamAppId: DRAGON_AGE_2_APP_ID,
          reason: 'Publisher requires EA App'
        }
      });
      expect(excludeRes.statusCode).toBe(200);
      const excludeJson = JSON.parse(excludeRes.body);
      expect(excludeJson.success).toBe(true);
      expect(excludeJson.steamAppId).toBe(DRAGON_AGE_2_APP_ID);

      // 2. Query exclusions via GET /api/family-sharing/exclusions
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/family-sharing/exclusions'
      });
      expect(getRes.statusCode).toBe(200);
      const getJson = JSON.parse(getRes.body);
      expect(Array.isArray(getJson)).toBe(true);
      expect(getJson.length).toBe(1);
      expect(getJson[0].steamAppId).toBe(DRAGON_AGE_2_APP_ID);
      expect(getJson[0].reason).toBe('Publisher requires EA App');

      // 3. Auto-detect endpoint with Dragon Age Inquisition
      const autoRes = await app.inject({
        method: 'POST',
        url: '/api/family-sharing/auto-detect',
        payload: {
          steamAppIds: [DRAGON_AGE_INQ_APP_ID, TERRARIA_APP_ID]
        }
      });
      expect(autoRes.statusCode).toBe(200);
      const autoJson = JSON.parse(autoRes.body);
      expect(autoJson.scannedCount).toBe(2);
      expect(autoJson.excludedCount).toBe(1);
      expect(autoJson.newlyExcluded[0].steamAppId).toBe(DRAGON_AGE_INQ_APP_ID);

      // 4. Restore Dragon Age 2 via POST /api/family-sharing/include
      const includeRes = await app.inject({
        method: 'POST',
        url: '/api/family-sharing/include',
        payload: {
          steamAppId: DRAGON_AGE_2_APP_ID
        }
      });
      expect(includeRes.statusCode).toBe(200);
      const includeJson = JSON.parse(includeRes.body);
      expect(includeJson.success).toBe(true);

      // Verify Dragon Age 2 is removed from exclusions, DAI remains
      const afterGetRes = await app.inject({
        method: 'GET',
        url: '/api/family-sharing/exclusions'
      });
      const afterGetJson = JSON.parse(afterGetRes.body);
      expect(afterGetJson.length).toBe(1);
      expect(afterGetJson[0].steamAppId).toBe(DRAGON_AGE_INQ_APP_ID);
    } finally {
      await app.close();
    }
  });
});

