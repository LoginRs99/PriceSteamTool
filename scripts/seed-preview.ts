import { randomUUID } from 'crypto';
import { getDb, profileRepo, gameRepo, merchantRepo, offerRepo } from '../src/server/db/index.js';

export function seedPreviewData() {
  const db = getDb();
  
  // Clear existing preview data
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM source_observations;
    DELETE FROM price_history;
    DELETE FROM anomalies;
    DELETE FROM offers;
    DELETE FROM wishlist_entries;
    DELETE FROM games;
    DELETE FROM profiles;
    PRAGMA foreign_keys = ON;
  `);

  // 1. Create Active Steam Profile
  const profile = profileRepo.create('Gamer Profile (Preview)', '76561198000000001');

  // 2. Sample Merchants
  const steamM = merchantRepo.getOrCreate('steam', 'Steam Store', true);
  const fanaticalM = merchantRepo.getOrCreate('fanatical', 'Fanatical', true);
  const gmgM = merchantRepo.getOrCreate('greenmangaming', 'Green Man Gaming', true);
  const cdkeysM = merchantRepo.getOrCreate('cdkeys', 'CDKeys', false);
  const kinguinM = merchantRepo.getOrCreate('kinguin', 'Kinguin', false);

  const now = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  // 3. Sample Games
  const gamesData = [
    {
      appId: 1091500,
      title: 'Cyberpunk 2077',
      isFree: false,
      basePrice: 59.99,
      histLow: 17.99,
      offers: [
        { merchant: fanaticalM, price: 17.99, orig: 59.99, isOfficial: true, source: 'itad', url: 'https://store.steampowered.com/app/1091500/' },
        { merchant: steamM, price: 29.99, orig: 59.99, isOfficial: true, source: 'steam', url: 'https://store.steampowered.com/app/1091500/' },
        { merchant: cdkeysM, price: 19.49, orig: 59.99, isOfficial: false, source: 'allkeyshop', url: 'https://cdkeys.com' }
      ]
    },
    {
      appId: 1245620,
      title: 'ELDEN RING',
      isFree: false,
      basePrice: 59.99,
      histLow: 32.99,
      offers: [
        { merchant: gmgM, price: 34.99, orig: 59.99, isOfficial: true, source: 'itad', url: 'https://greenmangaming.com' },
        { merchant: steamM, price: 59.99, orig: 59.99, isOfficial: true, source: 'steam', url: 'https://store.steampowered.com/app/1245620/' }
      ]
    },
    {
      appId: 1086940,
      title: "Baldur's Gate 3",
      isFree: false,
      basePrice: 59.99,
      histLow: 47.99,
      offers: [
        { merchant: steamM, price: 47.99, orig: 59.99, isOfficial: true, source: 'steam', url: 'https://store.steampowered.com/app/1086940/' }
      ]
    },
    {
      appId: 367520,
      title: 'Hollow Knight',
      isFree: false,
      basePrice: 14.79,
      histLow: 4.99,
      offers: [
        { merchant: steamM, price: 7.39, orig: 14.79, isOfficial: true, source: 'steam', url: 'https://store.steampowered.com/app/367520/' },
        { merchant: fanaticalM, price: 5.99, orig: 14.79, isOfficial: true, source: 'itad', url: 'https://fanatical.com' }
      ]
    },
    {
      appId: 1145360,
      title: 'Hades II',
      isFree: false,
      basePrice: 28.99,
      histLow: 26.09,
      offers: [
        { merchant: steamM, price: 26.09, orig: 28.99, isOfficial: true, source: 'steam', url: 'https://store.steampowered.com/app/1145360/' }
      ]
    },
    {
      appId: 730,
      title: 'Counter-Strike 2',
      isFree: true,
      basePrice: 0,
      histLow: 0,
      offers: [
        { merchant: steamM, price: 0, orig: 0, isOfficial: true, source: 'steam', url: 'https://store.steampowered.com/app/730/' }
      ]
    },
    {
      appId: 440,
      title: 'Team Fortress 2',
      isFree: true,
      basePrice: 0,
      histLow: 0,
      offers: [
        { merchant: steamM, price: 0, orig: 0, isOfficial: true, source: 'steam', url: 'https://store.steampowered.com/app/440/' }
      ]
    },
    {
      appId: 570,
      title: 'Dota 2',
      isFree: true,
      basePrice: 0,
      histLow: 0,
      offers: [
        { merchant: steamM, price: 0, orig: 0, isOfficial: true, source: 'steam', url: 'https://store.steampowered.com/app/570/' }
      ]
    },
    {
      appId: 892970,
      title: 'Valheim',
      isFree: false,
      basePrice: 19.99,
      histLow: 9.99,
      offers: [
        { merchant: steamM, price: 9.99, orig: 19.99, isOfficial: true, source: 'steam', url: 'https://store.steampowered.com/app/892970/' }
      ]
    },
    {
      appId: 271590,
      title: 'Grand Theft Auto V',
      isFree: false,
      basePrice: 29.99,
      histLow: 9.99,
      offers: [
        { merchant: kinguinM, price: 1.20, orig: 29.99, isOfficial: false, source: 'allkeyshop', url: 'https://kinguin.net', isAnomaly: true, anomalyReason: 'Suspicious 96% drop from unofficial keyshop' },
        { merchant: steamM, price: 14.99, orig: 29.99, isOfficial: true, source: 'steam', url: 'https://store.steampowered.com/app/271590/' }
      ]
    }
  ];

  // 3. Sync Wishlist entries
  gameRepo.syncWishlistEntries(
    profile.id,
    gamesData.map((g, idx) => ({
      steamAppId: g.appId,
      title: g.title,
      priority: idx + 1,
      isFree: g.isFree,
      basePriceEur: g.basePrice
    }))
  );

  for (const g of gamesData) {
    const game = gameRepo.getBySteamAppId(g.appId)!;

    // Add price history
    if (!g.isFree) {
      db.prepare(`
        INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, discount_percent, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), game.id, steamM.id, 'steam', g.basePrice, 0, monthAgo,
        randomUUID(), game.id, steamM.id, 'steam', Math.round(g.basePrice * 0.75 * 100) / 100, 25, weekAgo,
        randomUUID(), game.id, steamM.id, 'steam', g.offers[0].price, Math.round((1 - g.offers[0].price / g.basePrice) * 100), now
      );
    }

    for (const off of g.offers) {
      offerRepo.upsertOffer({
        gameId: game.id,
        merchantId: off.merchant.id,
        sourceCode: off.source as any,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        priceEur: off.price,
        originalPriceEur: off.orig,
        dealUrl: off.url,
        isAnomaly: Boolean((off as any).isAnomaly),
        anomalyReason: (off as any).anomalyReason,
        riskLevel: (off as any).isAnomaly ? 'HIGH' : 'SAFE'
      });
    }

    offerRepo.recomputeBestDealForGame(game.id);
  }

  console.log(`✅ Seeded preview database with ${gamesData.length} games and realistic pricing data!`);
}

seedPreviewData();
