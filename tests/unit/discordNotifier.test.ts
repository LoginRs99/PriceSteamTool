import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { 
  getDiscordSettings, 
  saveDiscordSettings, 
  sendTestNotification, 
  sendDealNotifications 
} from '../../src/server/domain/discordNotifier.js';
import { settingsRepo, notificationsRepo, offerRepo, gameRepo, closeDb } from '../../src/server/db/index.js';
import type { Game } from '../../src/shared/types.js';

describe('Discord Notifier Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should save and retrieve Discord settings from database', () => {
    saveDiscordSettings({
      webhookUrl: 'https://discord.com/api/webhooks/12345/abcdef',
      isEnabled: true,
      minDealScore: 80,
      notifyAtlOnly: true,
      notifyFreeGames: true,
      cooldownHours: 48
    });

    const settings = getDiscordSettings();
    expect(settings.webhookUrl).toBe('https://discord.com/api/webhooks/12345/abcdef');
    expect(settings.isEnabled).toBe(true);
    expect(settings.minDealScore).toBe(80);
    expect(settings.notifyAtlOnly).toBe(true);
    expect(settings.notifyFreeGames).toBe(true);
    expect(settings.cooldownHours).toBe(48);
  });

  it('should handle test notification with mocked fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const result = await sendTestNotification('https://discord.com/api/webhooks/test/123');
    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs[0]).toBe('https://discord.com/api/webhooks/test/123');
    const body = JSON.parse(callArgs[1]?.body as string);
    expect(body.username).toBe('PriceSteamTool');
    expect(body.embeds[0].title).toContain('PriceSteamTool');
  });

  it('should filter deals by minimum Deal Score and notify only qualifying games', async () => {
    saveDiscordSettings({
      webhookUrl: 'https://discord.com/api/webhooks/mock/deals',
      isEnabled: true,
      minDealScore: 75,
      notifyAtlOnly: false,
      notifyFreeGames: true,
      cooldownHours: 24
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const game1: Game = {
      id: 'game-qualifying-1',
      steamAppId: 1001,
      title: 'Super Deal Game',
      slug: 'super-deal-game',
      isDlc: false,
      isFree: false,
      hasAnomaly: false,
      offersCount: 1,
      bestPriceEur: 9.99,
      basePriceEur: 49.99,
      bestDiscountPercent: 80,
      bestDealScore: 88,
      bestDealTier: 'Exceptional',
      bestMerchantName: 'Steam Store',
      bestMerchantIsOfficial: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const game2: Game = {
      id: 'game-low-score',
      steamAppId: 1002,
      title: 'Mediocre Deal Game',
      slug: 'mediocre-deal-game',
      isDlc: false,
      isFree: false,
      hasAnomaly: false,
      offersCount: 1,
      bestPriceEur: 39.99,
      basePriceEur: 49.99,
      bestDiscountPercent: 20,
      bestDealScore: 45, // Below 75 threshold!
      bestDealTier: 'Fair',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    gameRepo.upsert({ steamAppId: 1001, title: 'Super Deal Game', slug: 'super-deal-game' });
    gameRepo.upsert({ steamAppId: 1002, title: 'Mediocre Deal Game', slug: 'mediocre-deal-game' });

    const inserted1 = gameRepo.getBySteamAppId(1001)!;
    const inserted2 = gameRepo.getBySteamAppId(1002)!;
    game1.id = inserted1.id;
    game2.id = inserted2.id;

    const mockDeals: Game[] = [game1, game2];

    const { sentCount } = await sendDealNotifications(mockDeals, 'TEST');
    expect(sentCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const sentPayload = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(sentPayload.embeds[0].title).toBe('Super Deal Game');
    expect(sentPayload.embeds[0].description).toContain('Exceptional Deal Detected');
  });

  it('should respect All-Time Low (ATL) filter when enabled', async () => {
    saveDiscordSettings({
      webhookUrl: 'https://discord.com/api/webhooks/mock/deals',
      isEnabled: true,
      minDealScore: 70,
      notifyAtlOnly: true, // Only ATL deals!
      notifyFreeGames: false,
      cooldownHours: 24
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    gameRepo.upsert({ steamAppId: 2001, title: 'ATL Game', slug: 'atl-game' });
    gameRepo.upsert({ steamAppId: 2002, title: 'Non-ATL Good Deal', slug: 'non-atl-game' });

    const insertedAtl = gameRepo.getBySteamAppId(2001)!;
    const insertedNonAtl = gameRepo.getBySteamAppId(2002)!;

    const mockDeals: Game[] = [
      {
        id: insertedAtl.id,
        steamAppId: 2001,
        title: 'ATL Game',
        slug: 'atl-game',
        isDlc: false,
        isFree: false,
        hasAnomaly: false,
        offersCount: 1,
        bestPriceEur: 12.99,
        basePriceEur: 59.99,
        bestDiscountPercent: 78,
        bestDealScore: 82,
        bestPriceEvent: 'NEW_HISTORICAL_LOW',
        historicalLowEur: 12.99,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: insertedNonAtl.id,
        steamAppId: 2002,
        title: 'Non-ATL Good Deal',
        slug: 'non-atl-game',
        isDlc: false,
        isFree: false,
        hasAnomaly: false,
        offersCount: 1,
        bestPriceEur: 24.99,
        basePriceEur: 59.99,
        bestDiscountPercent: 58,
        bestDealScore: 78, // High score, but not ATL!
        bestPriceEvent: 'NONE',
        historicalLowEur: 14.99,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    const { sentCount } = await sendDealNotifications(mockDeals, 'TEST');
    expect(sentCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(sentPayload.embeds[0].title).toBe('ATL Game');
  });

  it('should notify 100% free games when notifyFreeGames is enabled', async () => {
    saveDiscordSettings({
      webhookUrl: 'https://discord.com/api/webhooks/mock/deals',
      isEnabled: true,
      minDealScore: 85,
      notifyAtlOnly: true,
      notifyFreeGames: true, // Free games enabled
      cooldownHours: 24
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    gameRepo.upsert({ steamAppId: 3001, title: 'Free Giveaway Game', slug: 'free-giveaway-game' });
    const insertedFree = gameRepo.getBySteamAppId(3001)!;

    const freeGame: Game = {
      id: insertedFree.id,
      steamAppId: 3001,
      title: 'Free Giveaway Game',
      slug: 'free-giveaway-game',
      isDlc: false,
      isFree: true,
      hasAnomaly: false,
      offersCount: 1,
      bestPriceEur: 0,
      basePriceEur: 29.99,
      bestDiscountPercent: 100,
      bestDealScore: 30, // Low Deal Score score because base formula doesn't apply to free promotions
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { sentCount } = await sendDealNotifications([freeGame], 'TEST');
    expect(sentCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const sentPayload = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(sentPayload.embeds[0].title).toBe('Free Giveaway Game');
    expect(sentPayload.embeds[0].description).toContain('100% Free Game Promotion');
  });

  it('should suppress high-risk anomaly deals from triggering Discord notifications', async () => {
    saveDiscordSettings({
      webhookUrl: 'https://discord.com/api/webhooks/mock/deals',
      isEnabled: true,
      minDealScore: 70,
      minConfidence: 40,
      notifyAtlOnly: false,
      notifyFreeGames: true,
      cooldownHours: 24
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    gameRepo.upsert({ steamAppId: 4001, title: 'Glitch Price Game', slug: 'glitch-price-game' });
    const inserted = gameRepo.getBySteamAppId(4001)!;

    const anomalyGame: Game = {
      id: inserted.id,
      steamAppId: 4001,
      title: 'Glitch Price Game',
      slug: 'glitch-price-game',
      isDlc: false,
      isFree: false,
      hasAnomaly: true, // Marked as anomaly!
      bestRiskLevel: 'HIGH',
      offersCount: 1,
      bestPriceEur: 0.50,
      basePriceEur: 59.99,
      bestDiscountPercent: 99,
      bestDealScore: 98,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { sentCount } = await sendDealNotifications([anomalyGame], 'TEST');
    expect(sentCount).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should format provisional deals cleanly without claiming verified ATL status', async () => {
    saveDiscordSettings({
      webhookUrl: 'https://discord.com/api/webhooks/mock/deals',
      isEnabled: true,
      minDealScore: 60,
      minConfidence: 20,
      notifyAtlOnly: false,
      notifyFreeGames: false,
      cooldownHours: 24
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    gameRepo.upsert({ steamAppId: 5001, title: 'Provisional Game', slug: 'provisional-game' });
    const inserted = gameRepo.getBySteamAppId(5001)!;

    const provGame: Game = {
      id: inserted.id,
      steamAppId: 5001,
      title: 'Provisional Game',
      slug: 'provisional-game',
      isDlc: false,
      isFree: false,
      hasAnomaly: false,
      bestIsProvisional: true,
      bestConfidenceScore: 35,
      bestConfidenceTier: 'Low',
      offersCount: 1,
      bestPriceEur: 14.99,
      basePriceEur: 29.99,
      bestDiscountPercent: 50,
      bestDealScore: 65,
      bestDealTier: 'Good',
      historicalLowEur: 14.99,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { sentCount } = await sendDealNotifications([provGame], 'TEST');
    expect(sentCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const sentPayload = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(sentPayload.embeds[0].description).toContain('Provisional Deal Alert');
  });

  it('should filter out games whose data confidence is below the minConfidence threshold', async () => {
    saveDiscordSettings({
      webhookUrl: 'https://discord.com/api/webhooks/mock/deals',
      isEnabled: true,
      minDealScore: 70,
      minConfidence: 60, // Require Medium or higher confidence (>=60%)
      notifyAtlOnly: false,
      notifyFreeGames: false,
      cooldownHours: 24
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    gameRepo.upsert({ steamAppId: 6001, title: 'Low Conf Game', slug: 'low-conf' });
    gameRepo.upsert({ steamAppId: 6002, title: 'High Conf Game', slug: 'high-conf' });

    const insertedLow = gameRepo.getBySteamAppId(6001)!;
    const insertedHigh = gameRepo.getBySteamAppId(6002)!;

    const lowConfGame: Game = {
      id: insertedLow.id,
      steamAppId: 6001,
      title: 'Low Conf Game',
      slug: 'low-conf',
      isDlc: false,
      isFree: false,
      hasAnomaly: false,
      bestDealScore: 85,
      bestDealTier: 'Exceptional',
      bestConfidenceScore: 35, // Low (35 < 60)
      bestConfidenceTier: 'Low',
      offersCount: 1,
      bestPriceEur: 9.99,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const highConfGame: Game = {
      id: insertedHigh.id,
      steamAppId: 6002,
      title: 'High Conf Game',
      slug: 'high-conf',
      isDlc: false,
      isFree: false,
      hasAnomaly: false,
      bestDealScore: 85,
      bestDealTier: 'Exceptional',
      bestConfidenceScore: 85, // High (85 >= 60)
      bestConfidenceTier: 'High',
      offersCount: 1,
      bestPriceEur: 9.99,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { sentCount } = await sendDealNotifications([lowConfGame, highConfGame], 'TEST');
    expect(sentCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const sentPayload = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(sentPayload.embeds[0].title).toBe('High Conf Game');
  });

  it('should dispatch alert when targetPriceEur is met regardless of low Deal Score or low Confidence', async () => {
    saveDiscordSettings({
      webhookUrl: 'https://discord.com/api/webhooks/mock/deals',
      isEnabled: true,
      minDealScore: 80, // Very strict Deal Score threshold
      minConfidence: 75, // Very strict confidence threshold
      notifyAtlOnly: true, // Strict ATL requirement
      notifyFreeGames: false,
      cooldownHours: 24
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    gameRepo.upsert({ steamAppId: 7001, title: 'Target Hit Game', slug: 'target-hit-game' });
    const inserted = gameRepo.getBySteamAppId(7001)!;

    const targetGame: Game = {
      id: inserted.id,
      steamAppId: 7001,
      title: 'Target Hit Game',
      slug: 'target-hit-game',
      isDlc: false,
      isFree: false,
      hasAnomaly: false,
      bestRiskLevel: 'SAFE',
      bestDealScore: 40, // Low Deal Score (40 < 80)
      bestConfidenceScore: 30, // Low Confidence (30 < 75)
      bestPriceEvent: 'NONE', // Not an ATL deal!
      targetPriceEur: 15.00, // Explicit target price
      bestPriceEur: 14.50, // Price satisfies target price (€14.50 <= €15.00)
      offersCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { sentCount } = await sendDealNotifications([targetGame], 'TEST');
    expect(sentCount).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const sentPayload = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(sentPayload.embeds[0].title).toBe('Target Hit Game');
    expect(sentPayload.embeds[0].description).toContain('Target Price Reached');
  });

  it('should still suppress target price deals if the offer has an anomaly or high risk', async () => {
    saveDiscordSettings({
      webhookUrl: 'https://discord.com/api/webhooks/mock/deals',
      isEnabled: true,
      minDealScore: 50,
      minConfidence: 30,
      notifyAtlOnly: false,
      notifyFreeGames: false,
      cooldownHours: 24
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    gameRepo.upsert({ steamAppId: 7002, title: 'Glitch Target Game', slug: 'glitch-target-game' });
    const inserted = gameRepo.getBySteamAppId(7002)!;

    const glitchTargetGame: Game = {
      id: inserted.id,
      steamAppId: 7002,
      title: 'Glitch Target Game',
      slug: 'glitch-target-game',
      isDlc: false,
      isFree: false,
      hasAnomaly: true, // Pricing anomaly detected!
      bestRiskLevel: 'HIGH',
      targetPriceEur: 10.00,
      bestPriceEur: 0.99, // Unbelievably cheap, but suppressed due to anomaly
      offersCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { sentCount } = await sendDealNotifications([glitchTargetGame], 'TEST');
    expect(sentCount).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should reject invalid non-Discord webhook URLs to prevent SSRF', async () => {
    const resInternal = await sendTestNotification('http://169.254.169.254/latest/meta-data');
    expect(resInternal.success).toBe(false);
    expect(resInternal.error).toContain('Invalid Discord Webhook URL');

    const resHttp = await sendTestNotification('http://discord.com/api/webhooks/123/abc');
    expect(resHttp.success).toBe(false);
    expect(resHttp.error).toContain('Invalid Discord Webhook URL');
  });

  it('strictly blocks Discord push alerts for stale observations (bestIsFresh === false)', async () => {
    saveDiscordSettings({
      webhookUrl: 'https://discord.com/api/webhooks/mock/stale-test',
      isEnabled: true,
      minDealScore: 70,
      minConfidence: 30,
      notifyAtlOnly: false,
      notifyFreeGames: true,
      cooldownHours: 24
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    gameRepo.upsert({ steamAppId: 8001, title: 'Stale Deal Game', slug: 'stale-deal-game' });
    const inserted = gameRepo.getBySteamAppId(8001)!;

    const staleGame: Game = {
      id: inserted.id,
      steamAppId: 8001,
      title: 'Stale Deal Game',
      slug: 'stale-deal-game',
      isDlc: false,
      isFree: false,
      bestPriceEur: 4.99,
      bestDiscountPercent: 85,
      bestDealScore: 92, // Outstanding score!
      bestConfidenceScore: 80,
      bestIsFresh: false, // STALE OBSERVATION (>72h)
      bestRiskLevel: 'SAFE',
      hasAnomaly: false,
      offersCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const { sentCount } = await sendDealNotifications([staleGame], 'TEST');
    expect(sentCount).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Now verify that if it is fresh, it is sent
    const freshGame: Game = {
      ...staleGame,
      bestIsFresh: true
    };
    const { sentCount: freshSent } = await sendDealNotifications([freshGame], 'TEST');
    expect(freshSent).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

