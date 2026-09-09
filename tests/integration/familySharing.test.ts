import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getDb, closeDb } from '../../src/server/db/core.js';
import { profileRepo } from '../../src/server/db/repositories/profile.js';
import { gameRepo } from '../../src/server/db/repositories/game.js';

function resetDatabase() {
  const db = getDb();
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM family_owned_apps;
    DELETE FROM wishlist_entries;
    DELETE FROM games;
    DELETE FROM profiles;
    PRAGMA foreign_keys = ON;
  `);
}

describe('Steam Family Sharing Integration Tests', () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterAll(() => {
    closeDb();
  });

  it('runs migration 016 cleanly and allows family member tagging and library tracking', () => {
    // 1. Create main user profile
    const mainUser = profileRepo.create('Main Player', '76561198000000001');
    expect(mainUser.isActive).toBe(true);
    expect(mainUser.isFamily).toBe(false);

    // 2. Create family member profile
    const partner = profileRepo.create('Partner', '76561198000000002', undefined, undefined, true);
    expect(partner.isFamily).toBe(true);

    // 3. Add games to database and main user's wishlist
    const game1 = gameRepo.upsert({ steamAppId: 1091500, title: 'Cyberpunk 2077', basePriceEur: 59.99 });
    const game2 = gameRepo.upsert({ steamAppId: 1086940, title: "Baldur's Gate 3", basePriceEur: 59.99 });
    const game3 = gameRepo.upsert({ steamAppId: 292030, title: 'The Witcher 3', basePriceEur: 29.99 });

    gameRepo.syncWishlistEntries(mainUser.id, [
      { steamAppId: 1091500, title: 'Cyberpunk 2077', priority: 1, basePriceEur: 59.99 },
      { steamAppId: 1086940, title: "Baldur's Gate 3", priority: 2, basePriceEur: 59.99 },
      { steamAppId: 292030, title: 'The Witcher 3', priority: 3, basePriceEur: 29.99 },
    ]);

    // 4. Partner owns Cyberpunk 2077 and The Witcher 3
    profileRepo.saveFamilyOwnedApps(partner.id, [1091500, 292030]);

    // Verify profile list includes family member and count
    const profiles = profileRepo.list();
    const partnerProfile = profiles.find(p => p.id === partner.id);
    expect(partnerProfile).toBeDefined();
    expect(partnerProfile?.isFamily).toBe(true);
    expect(partnerProfile?.familyGamesCount).toBe(2);

    // 5. Query wishlist without filters: all 3 returned, Cyberpunk and Witcher marked as isFamilyShared = true
    const resAll = gameRepo.getWishlistGames(mainUser.id);
    expect(resAll.games.length).toBe(3);

    const cp = resAll.games.find(g => g.steamAppId === 1091500);
    const bg3 = resAll.games.find(g => g.steamAppId === 1086940);
    const w3 = resAll.games.find(g => g.steamAppId === 292030);

    expect(cp?.isFamilyShared).toBe(true);
    expect(bg3?.isFamilyShared).toBe(false);
    expect(w3?.isFamilyShared).toBe(true);

    // 6. Query wishlist with hideFamilyShared: true -> only Baldur's Gate 3 returned!
    const resFiltered = gameRepo.getWishlistGames(mainUser.id, { hideFamilyShared: true });
    expect(resFiltered.games.length).toBe(1);
    expect(resFiltered.games[0].steamAppId).toBe(1086940);
    expect(resFiltered.games[0].title).toBe("Baldur's Gate 3");

    // 7. Toggle partner family role to false -> family sharing no longer flags those games
    profileRepo.setFamily(partner.id, false);
    const resAfterToggle = gameRepo.getWishlistGames(mainUser.id, { hideFamilyShared: true });
    expect(resAfterToggle.games.length).toBe(3);
  });
});
