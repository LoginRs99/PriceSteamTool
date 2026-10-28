import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { 
  profileRepo, 
  gameRepo, 
  offerRepo, 
  sourceRepo, 
  pricingErrorRepo,
  purchaseRepo 
} from '../db/index.js';
import { syncOrchestrator } from '../sync/orchestrator.js';
import { priceHistoryQueue } from '../sync/historyQueue.js';
import { steamAdapter } from '../sources/steam.js';
import { config } from '../config/index.js';
import { exchangeRateService } from '../domain/exchangeRate.js';
import type { WishlistFilterOptions, SourceCode } from '../../shared/types.js';
import { logWarn } from '../utils/logger.js';

function safeFloat(val: any): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

function safeInt(val: any, fallback?: number): number | undefined {
  if (val === undefined || val === null || val === '') return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

export const apiRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // ----------------------------------------------------
  // Health & Diagnostics
  // ----------------------------------------------------
  const errorResponseSchema = {
    type: 'object',
    properties: {
      error: { type: 'string' },
      statusCode: { type: 'number' },
      details: { type: 'array' }
    },
    additionalProperties: true
  };

  const healthResponseSchema = {
    type: 'object',
    properties: {
      status: { type: 'string' },
      timestamp: { type: 'string' },
      database: { type: 'string' },
      syncRunning: { type: 'boolean' },
      circuitBreakers: { type: 'object', additionalProperties: true },
      uptimeSeconds: { type: 'number' },
      memory: {
        type: 'object',
        properties: {
          rssMb: { type: 'number' },
          heapUsedMb: { type: 'number' }
        }
      }
    }
  };

  const healthHandler = async () => {
    let dbStatus = 'ok';
    try {
      const { getDb } = await import('../db/index.js');
      getDb().prepare('SELECT 1').get();
    } catch {
      dbStatus = 'degraded';
    }

    const { circuitBreakers } = await import('../sync/circuitBreaker.js');
    const circuitStates = circuitBreakers.getAllStates();

    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      syncRunning: syncOrchestrator.isSyncRunning(),
      circuitBreakers: circuitStates,
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024))
      }
    };
  };

  fastify.get('/api/health', { schema: { response: { 200: healthResponseSchema } } }, healthHandler);
  fastify.get('/health', { schema: { response: { 200: healthResponseSchema } } }, healthHandler);

  // ----------------------------------------------------
  // Database Backup & Maintenance API
  // ----------------------------------------------------
  const backupItemSchema = {
    type: 'object',
    properties: {
      filename: { type: 'string' },
      sizeBytes: { type: 'number' },
      createdAt: { type: 'string' }
    }
  };

  fastify.post('/api/backup', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            backup: backupItemSchema
          }
        },
        500: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    try {
      const { createDatabaseBackup } = await import('../db/index.js');
      const result = await createDatabaseBackup();
      return { success: true, backup: result };
    } catch (err: any) {
      request.log.error(err, '[Backup] Manual backup failed');
      return reply.status(500).send({ error: `Backup failed: ${err.message}` });
    }
  });

  fastify.get('/api/backups', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            count: { type: 'number' },
            backups: {
              type: 'array',
              items: backupItemSchema
            }
          }
        },
        500: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    try {
      const { listBackups } = await import('../db/index.js');
      const backups = listBackups();
      return { success: true, backups, count: backups.length };
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to list backups: ${err.message}` });
    }
  });

  // ----------------------------------------------------
  // Profiles API
  // ----------------------------------------------------
  const profileItemSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      steamId: { type: 'string' },
      customUrl: { type: ['string', 'null'] },
      avatarUrl: { type: ['string', 'null'] },
      isActive: { type: 'boolean' },
      isFamily: { type: 'boolean' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' }
    }
  };

  fastify.get('/api/profiles', {
    schema: {
      response: {
        200: {
          type: 'array',
          items: profileItemSchema
        }
      }
    }
  }, async () => {
    return profileRepo.list();
  });

  fastify.post('/api/profiles', {
    schema: {
      response: {
        201: profileItemSchema,
        400: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    const schema = z.object({
      name: z.string().min(1),
      steamId: z.string().min(1),
      customUrl: z.string().optional(),
      isFamily: z.boolean().optional()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    // Resolve steam ID if vanity url or input provided
    const resolved = await steamAdapter.resolveSteamId64(parsed.data.steamId);
    const profile = profileRepo.create(
      parsed.data.name,
      resolved.steamId64,
      parsed.data.customUrl,
      resolved.avatarUrl,
      parsed.data.isFamily ?? false
    );

    return reply.status(201).send(profile);
  });

  fastify.put('/api/profiles/:id/active', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } }
        },
        404: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = profileRepo.setActive(id);
    if (!ok) {
      return reply.status(404).send({ error: `Profile not found with id "${id}"` });
    }
    return { success: true };
  });

  fastify.delete('/api/profiles/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } }
        },
        404: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = profileRepo.getById(id);
    if (!existing) {
      return reply.status(404).send({ error: `Profile not found with id "${id}"` });
    }
    profileRepo.delete(id);
    return { success: true };
  });

  fastify.put('/api/profiles/:id/family', async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({
      isFamily: z.boolean().optional()
    });
    const parsed = schema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid isFamily parameter', details: parsed.error.issues });
    }
    const profile = profileRepo.getById(id);
    if (!profile) return reply.status(404).send({ error: 'Profile not found' });
    const isFamily = parsed.data.isFamily !== undefined ? parsed.data.isFamily : !profile.isFamily;
    profileRepo.setFamily(id, isFamily);
    return { success: true, isFamily };
  });

  fastify.post('/api/profiles/:id/sync-family', async (request, reply) => {
    const { id } = request.params as { id: string };
    const profile = profileRepo.getById(id);
    if (!profile) return reply.status(404).send({ error: 'Profile not found' });

    try {
      const appIds = await steamAdapter.fetchOwnedGames(profile.steamId);
      profileRepo.saveFamilyOwnedApps(id, appIds);
      return { success: true, gameCount: appIds.length };
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to sync family library: ${err.message}` });
    }
  });

  // ----------------------------------------------------
  // Family Sharing Exclusions API
  // ----------------------------------------------------
  const exclusionItemSchema = {
    type: 'object',
    properties: {
      steamAppId: { type: 'number' },
      title: { type: ['string', 'null'] },
      reason: { type: ['string', 'null'] },
      createdAt: { type: 'string' }
    }
  };

  fastify.get('/api/family-sharing/exclusions', {
    schema: {
      response: {
        200: {
          type: 'array',
          items: exclusionItemSchema
        }
      }
    }
  }, async () => {
    const activeProfile = profileRepo.getActive();
    if (activeProfile) {
      profileRepo.pruneExclusionsNotInWishlist(activeProfile.id);
    }
    return profileRepo.getFamilySharingExclusions();
  });

  fastify.post('/api/family-sharing/exclude', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            steamAppId: { type: 'number' },
            reason: { type: ['string', 'null'] }
          }
        },
        400: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    const schema = z.object({
      steamAppId: z.number().int().positive(),
      reason: z.string().max(500).optional()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid steamAppId', details: parsed.error.issues });
    }
    profileRepo.excludeFamilySharingApp(parsed.data.steamAppId, parsed.data.reason);
    return { success: true, steamAppId: parsed.data.steamAppId, reason: parsed.data.reason };
  });

  fastify.post('/api/family-sharing/include', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            steamAppId: { type: 'number' }
          }
        },
        400: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    const schema = z.object({
      steamAppId: z.number().int().positive()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid steamAppId', details: parsed.error.issues });
    }
    profileRepo.includeFamilySharingApp(parsed.data.steamAppId);
    return { success: true, steamAppId: parsed.data.steamAppId };
  });

  fastify.post('/api/family-sharing/auto-detect', async (request, reply) => {
    const schema = z.object({
      steamAppIds: z.array(z.number().int().positive()).optional()
    }).optional();
    const parsed = schema?.safeParse(request.body || {});
    let targetAppIds: number[] = [];

    const activeProfile = profileRepo.getActive();
    if (activeProfile) {
      profileRepo.pruneExclusionsNotInWishlist(activeProfile.id);
    }

    if (parsed && parsed.success && parsed.data?.steamAppIds && parsed.data.steamAppIds.length > 0) {
      targetAppIds = parsed.data.steamAppIds;
    } else if (activeProfile) {
      // Find games on the active user's wishlist that family members own and are not yet excluded
      const familyWishlistAppIds = profileRepo.getFamilyOwnedWishlistAppIds(activeProfile.id);
      const excludedAppIds = profileRepo.getFamilySharingExcludedAppIds();
      targetAppIds = Array.from(familyWishlistAppIds).filter(appId => !excludedAppIds.has(appId));
    } else {
      targetAppIds = [];
    }

    const newlyExcluded: Array<{ steamAppId: number; title?: string; reason: string }> = [];

    for (const appId of targetAppIds) {
      try {
        const check = await steamAdapter.checkFamilySharingSupport(appId);
        if (!check.isShareable) {
          const reason = check.reason || 'Not supported by Family Sharing';
          profileRepo.excludeFamilySharingApp(appId, reason);
          newlyExcluded.push({ steamAppId: appId, title: check.title, reason });
        }
      } catch (err: any) {
        logWarn('Failed to check family sharing support for game', { appId, error: err.message });
      }
    }

    return {
      scannedCount: targetAppIds.length,
      excludedCount: newlyExcluded.length,
      newlyExcluded
    };
  });

  // ----------------------------------------------------
  // Games & Wishlist API
  // ----------------------------------------------------
  fastify.get('/api/games', async (request, reply) => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return { games: [], total: 0, activeProfile: null };
    }

    const query = request.query as any;
    const filterOptions: WishlistFilterOptions = {
      search: query.search || undefined,
      sort: query.sort || 'best_value',
      saleOnly: query.saleOnly === 'true' || query.saleOnly === true,
      majorDealsOnly: query.majorDealsOnly === 'true' || query.majorDealsOnly === true,
      allTimeLowOnly: query.allTimeLowOnly === 'true' || query.allTimeLowOnly === true || query.historicalLowOnly === 'true' || query.historicalLowOnly === true,
      isFreeOnly: query.isFreeOnly === 'true' || query.isFreeOnly === true ? true : query.isFreeOnly === 'false' || query.isFreeOnly === false ? false : undefined,
      underPrice: safeFloat(query.underPrice),
      minPrice: safeFloat(query.minPrice),
      maxPrice: safeFloat(query.maxPrice),
      minDiscount: safeInt(query.minDiscount),
      minDealScore: safeInt(query.minDealScore),
      minConfidence: safeInt(query.minConfidence),
      minMetacritic: safeInt(query.minMetacritic),
      minSteamRating: safeInt(query.minSteamRating),
      belowTypicalSaleOnly: query.belowTypicalSaleOnly === 'true' || query.belowTypicalSaleOnly === true,
      hidePricingErrors: query.hidePricingErrors === 'true' || query.hidePricingErrors === true || query.hideAnomalies === 'true' || query.hideAnomalies === true,
      hideProvisional: query.hideProvisional === 'true' || query.hideProvisional === true,
      buyOnly: query.buyOnly === 'true' || query.buyOnly === true,
      targetReachedOnly: query.targetReachedOnly === 'true' || query.targetReachedOnly === true,
      actionDecision: typeof query.actionDecision === 'string'
        ? (query.actionDecision.split(',').map((s: string) => s.trim()).filter(Boolean) as any)
        : Array.isArray(query.actionDecision) ? query.actionDecision : undefined,
      priceEvent: query.priceEvent ? String(query.priceEvent).trim() as any : undefined,
      merchantType: query.merchantType || 'all',
      hasPricingErrors: query.hasPricingErrors === 'true' || query.hasPricingErrors === true || query.hasAnomaly === 'true' || query.hasAnomaly === true,
      hideUnreleased: query.hideUnreleased === 'true' || query.hideUnreleased === true,
      hideDlcs: query.hideDlcs === 'true' || query.hideDlcs === true,
      includeFreeGames: query.includeFreeGames === 'true' || query.includeFreeGames === true,
      hideFamilyShared: query.hideFamilyShared === 'true' || query.hideFamilyShared === true,
      page: safeInt(query.page, 1) || 1,
      limit: Math.min(500, Math.max(1, safeInt(query.limit, 50) || 50)),
    };

    const result = gameRepo.getWishlistGames(activeProfile.id, filterOptions);

    // ETag caching header support: eliminate redundant network transfers when unchanged
    const latestUpdate = result.games.reduce((latest, g) => (g.updatedAt > latest ? g.updatedAt : latest), '');
    const etag = `W/"wishlist-${activeProfile.id}-${result.total}-${filterOptions.page}-${filterOptions.limit}-${latestUpdate}"`;
    reply.header('ETag', etag);

    if (request.headers['if-none-match'] === etag) {
      return reply.status(304).send();
    }

    return {
      ...result,
      activeProfile,
      page: filterOptions.page,
      limit: filterOptions.limit
    };
  });

  const getStatisticsHandler = async () => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return {
        totalGames: 0,
        gamesOnSale: 0,
        gamesAtHistoricalLow: 0,
        majorDropsCount: 0,
        gamesWithPricingErrors: 0,
        averageDiscountPercent: 0
      };
    }
    return gameRepo.getWishlistStatistics(activeProfile.id);
  };

  fastify.get('/api/wishlist/statistics', getStatisticsHandler);
  fastify.get('/api/games/statistics', getStatisticsHandler);

  const getBestDealsHandler = async (request: FastifyRequest) => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return { deals: [] };
    }
    const query = request.query as any;
    const limit = Math.min(100, Math.max(1, safeInt(query.limit, 50) || 50));
    const minTier = query.minTier !== undefined ? (query.minTier || undefined) : 'Good';
    const deals = gameRepo.getBestDeals(activeProfile.id, limit, { minTier, hideFamilyShared: true });
    return { deals };
  };

  fastify.get('/api/wishlist/best-deals', getBestDealsHandler);
  fastify.get('/api/games/best-deals', getBestDealsHandler);

  fastify.post('/api/wishlist/:gameId/target-price', {
    schema: {
      params: {
        type: 'object',
        required: ['gameId'],
        properties: { gameId: { type: 'string' } }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            gameId: { type: 'string' },
            targetPriceEur: { type: ['number', 'null'] }
          }
        },
        400: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return reply.status(400).send({ error: 'No active profile found' });
    }
    const { gameId } = request.params as { gameId: string };

    const schema = z.object({
      targetPriceEur: z.number().min(0).nullable()
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid targetPriceEur', details: parsed.error.issues });
    }

    const targetPrice = parsed.data.targetPriceEur !== null
      ? Math.max(0, parsed.data.targetPriceEur)
      : null;

    const success = gameRepo.setTargetPrice(activeProfile.id, gameId, targetPrice);
    return {
      success,
      gameId,
      targetPriceEur: targetPrice
    };
  });

  fastify.get('/api/games/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    let game = gameRepo.getById(id);
    if (!game) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    if (!game.priceHistorySeededAt && config.itadApiKey) {
      try {
        await priceHistoryQueue.seedGame(id, { timeoutMs: 2500 });
        game = gameRepo.getById(id) || game;
      } catch {
        priceHistoryQueue.seedGame(id, { timeoutMs: 10000 }).catch(() => {});
      }
    }

    const offers = offerRepo.getOffersForGame(id);
    const history = offerRepo.getPriceHistory(id, 50);

    return {
      game,
      offers,
      history
    };
  });

  fastify.get('/api/games/:id/intelligence', async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = gameRepo.getById(id);
    if (!game) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    if (!game.priceHistorySeededAt && config.itadApiKey) {
      try {
        await priceHistoryQueue.seedGame(id, { timeoutMs: 2500 });
      } catch {
        priceHistoryQueue.seedGame(id, { timeoutMs: 10000 }).catch(() => {});
      }
    }

    const intelligence = gameRepo.getPriceIntelligence(id);
    if (!intelligence) {
      return reply.status(404).send({ error: 'Game not found' });
    }
    return intelligence;
  });

  // Per-game force refresh (Fast parallel sync + async AllKeyShop enrichment or specific sources)
  fastify.post('/api/games/:id/refresh', async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({
      sources: z.array(z.enum(['steam', 'itad', 'cheapshark', 'ggdeals', 'allkeyshop'])).optional(),
      includeKeyshops: z.boolean().optional()
    }).optional();

    const parsed = schema.safeParse(request.body);
    const sources = parsed.success ? parsed.data?.sources : undefined;
    const includeKeyshops = parsed.success && parsed.data?.includeKeyshops !== undefined 
      ? parsed.data.includeKeyshops 
      : true;

    try {
      const result = await syncOrchestrator.refreshGame(id, { sources, includeKeyshops });
      return result;
    } catch (err: any) {
      if (err.message && err.message.includes('not found')) {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // ----------------------------------------------------
  // Synchronization API
  // ----------------------------------------------------
  fastify.post('/api/sync/start', async (request, reply) => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return reply.status(400).send({ error: 'Please create and select an active Steam profile first.' });
    }

    const schema = z.object({
      forceRefresh: z.boolean().optional(),
      sources: z.array(z.enum(['steam', 'itad', 'ggdeals', 'cheapshark', 'allkeyshop'])).optional()
    }).optional();

    const parsed = schema.safeParse(request.body);
    const forceRefresh = Boolean(parsed.success && parsed.data?.forceRefresh);
    const selectedSources = parsed.success && parsed.data?.sources ? parsed.data.sources as SourceCode[] : undefined;

    try {
      const progress = await syncOrchestrator.startSync(activeProfile.id, forceRefresh, selectedSources, 'MANUAL');
      return progress;
    } catch (err: any) {
      return reply.status(err.status || 500).send({ error: err.message });
    }
  });

  fastify.post('/api/sync/cancel', async () => {
    syncOrchestrator.cancelSync();
    return { success: true };
  });

  fastify.get('/api/sync/status', async () => {
    return syncOrchestrator.getProgress();
  });

  fastify.get('/api/sync/overview', async () => {
    return syncOrchestrator.getSyncStatus();
  });

  // Server-Sent Events (SSE) for Real-Time Sync Updates
  // Supports both /api/sync/events and /api/sync/stream
  const syncSseHandler = async (request: FastifyRequest, reply: any) => {
    reply.hijack();
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    // Origin reflection for CORS if trustedOrigins specified
    const origin = (request.headers as any).origin;
    if (config.trustedOrigins && config.trustedOrigins.length > 0) {
      if (origin && config.trustedOrigins.includes(origin)) {
        reply.raw.setHeader('Access-Control-Allow-Origin', origin);
      }
    } else {
      reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    }
    reply.raw.flushHeaders();

    // Immediately push current sync state so client UI is immediately hydrated
    try {
      const currentProgress = syncOrchestrator.getProgress();
      reply.raw.write(`data: ${JSON.stringify(currentProgress)}\n\n`);
    } catch {}

    let cleanedUp = false;
    let heartbeatTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      unsubscribe();
      try {
        if (!reply.raw.writableEnded && !reply.raw.destroyed) {
          reply.raw.end();
        }
      } catch {}
    };

    // Periodic SSE heartbeat ping (every 15 seconds) to prevent proxy & NAT timeouts
    heartbeatTimer = setInterval(() => {
      if (!reply.raw.writableEnded && !reply.raw.destroyed && reply.raw.writable) {
        try {
          reply.raw.write(': ping\n\n');
        } catch {
          cleanup();
        }
      } else {
        cleanup();
      }
    }, 15000);
    heartbeatTimer.unref();

    const unsubscribe = syncOrchestrator.subscribe((data) => {
      if (!reply.raw.writableEnded && !reply.raw.destroyed && reply.raw.writable) {
        try {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          cleanup();
        }
      } else {
        cleanup();
      }
    });

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
    reply.raw.on('close', cleanup);
    reply.raw.on('error', cleanup);
  };

  fastify.get('/api/sync/events', syncSseHandler);
  fastify.get('/api/sync/stream', syncSseHandler);

  // ----------------------------------------------------
  // Sources & Diagnostics API
  // ----------------------------------------------------
  const exchangeRatesResponseSchema = {
    type: 'object',
    properties: {
      base: { type: 'string' },
      rates: {
        type: 'object',
        additionalProperties: { type: 'number' }
      }
    }
  };

  fastify.get('/api/exchange-rates', {
    schema: {
      response: {
        200: exchangeRatesResponseSchema
      }
    }
  }, async () => {
    return {
      base: 'EUR',
      rates: exchangeRateService.getRatesFromEur()
    };
  });

  fastify.get('/api/sources', async () => {
    return sourceRepo.list();
  });

  const SourceCodeSchema = z.enum(['steam', 'itad', 'ggdeals', 'cheapshark', 'allkeyshop']);

  fastify.post('/api/sources/:code/toggle', async (request, reply) => {
    const { code } = request.params as { code: SourceCode };
    const codeParsed = SourceCodeSchema.safeParse(code);
    if (!codeParsed.success) {
      return reply.status(400).send({ error: `Invalid source code "${code}". Must be one of: steam, itad, ggdeals, cheapshark, allkeyshop` });
    }

    const schema = z.object({ isEnabled: z.boolean() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    sourceRepo.toggle(code, parsed.data.isEnabled);
    if (parsed.data.isEnabled) {
      const { circuitBreakers } = await import('../sync/circuitBreaker.js');
      circuitBreakers.reset(code);
      sourceRepo.resetCircuit(code);
      if (code === 'allkeyshop') {
        const { allkeyshopQueue } = await import('../sync/allkeyshop/index.js');
        allkeyshopQueue.reset();
      }
    }
    return { success: true, code, isEnabled: parsed.data.isEnabled };
  });

  fastify.post('/api/sources/:code/reset', async (request, reply) => {
    const { code } = request.params as { code: SourceCode };
    const codeParsed = SourceCodeSchema.safeParse(code);
    if (!codeParsed.success) {
      return reply.status(400).send({ error: `Invalid source code "${code}". Must be one of: steam, itad, ggdeals, cheapshark, allkeyshop` });
    }

    const { circuitBreakers } = await import('../sync/circuitBreaker.js');
    circuitBreakers.reset(code);
    sourceRepo.resetCircuit(code);
    if (code === 'allkeyshop') {
      const { allkeyshopQueue } = await import('../sync/allkeyshop/index.js');
      allkeyshopQueue.reset();
    }
    return { success: true, code, state: 'NORMAL' };
  });

  fastify.post('/api/sources/allkeyshop/refresh-catalog', async (request, reply) => {
    try {
      const { allkeyshopAdapter } = await import('../sources/allkeyshop.js');
      const catalog = await allkeyshopAdapter.ensureCatalogQueued(true);
      return { success: true, count: catalog.length };
    } catch (err: any) {
      return reply.status(502).send({ error: `Catalog refresh failed: ${err.message}` });
    }
  });

  // Diagnostics & Debug Logs Export
  fastify.get('/api/diagnostics/logs', async (request, reply) => {
    const { getRecentDiagnosticsLogs } = await import('../utils/logger.js');
    const lines = getRecentDiagnosticsLogs(300);
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return lines;
  });

  fastify.get('/api/diagnostics/summary', async () => {
    const sources = sourceRepo.list();
    return {
      timestamp: new Date().toISOString(),
      syncRunning: syncOrchestrator.isSyncRunning(),
      sources
    };
  });

  // ----------------------------------------------------
  // Pricing Errors API (with /api/anomalies backward-compatibility aliases)
  // ----------------------------------------------------
  const listPricingErrorsHandler = async () => pricingErrorRepo.list();

  const dismissPricingErrorHandler = async (request: any) => {
    const { id } = request.params as { id: string };
    const gameId = pricingErrorRepo.dismiss(id);
    if (gameId) {
      offerRepo.recomputeBestDealForGame(gameId);
    }
    return { success: true };
  };

  const dismissAllPricingErrorsHandler = async () => {
    const affectedGameIds = pricingErrorRepo.dismissAll();
    for (const gameId of affectedGameIds) {
      offerRepo.recomputeBestDealForGame(gameId);
    }
    return { success: true, count: affectedGameIds.length };
  };

  fastify.get('/api/pricing-errors', listPricingErrorsHandler);
  fastify.get('/api/anomalies', listPricingErrorsHandler);

  fastify.post('/api/pricing-errors/:id/dismiss', dismissPricingErrorHandler);
  fastify.post('/api/anomalies/:id/dismiss', dismissPricingErrorHandler);

  fastify.post('/api/pricing-errors/dismiss-all', dismissAllPricingErrorsHandler);
  fastify.post('/api/anomalies/dismiss-all', dismissAllPricingErrorsHandler);

  fastify.post('/api/anomalies/:id/feedback', async (request, reply) => {
    const { id } = request.params as { id: string };
    const schema = z.object({
      feedback: z.enum(['CONFIRMED_ERROR', 'FALSE_POSITIVE', 'DISMISSED'])
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid feedback value', details: parsed.error.issues });
    }

    const res = pricingErrorRepo.recordFeedback(id, parsed.data.feedback);
    if (!res) {
      return reply.status(404).send({ error: 'Anomaly / pricing error not found' });
    }

    if (res.gameId) {
      offerRepo.recomputeBestDealForGame(res.gameId);
    }

    return { success: true, ...res };
  });

  fastify.get('/api/anomalies/stats', async () => {
    return pricingErrorRepo.getMerchantStats();
  });

  // ----------------------------------------------------
  // Purchase Journal & Savings Tracker API
  // ----------------------------------------------------
  const purchaseItemSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      profileId: { type: 'string' },
      profileName: { type: ['string', 'null'] },
      gameId: { type: 'string' },
      gameTitle: { type: ['string', 'null'] },
      steamAppId: { type: ['number', 'null'] },
      offerId: { type: ['string', 'null'] },
      merchantId: { type: ['string', 'null'] },
      merchantName: { type: ['string', 'null'] },
      priceEur: { type: 'number' },
      msrpEur: { type: ['number', 'null'] },
      typicalMedianEur: { type: ['number', 'null'] },
      savingsVsMsrpEur: { type: 'number' },
      savingsVsMedianEur: { type: 'number' },
      purchasedAt: { type: 'string' },
      notes: { type: ['string', 'null'] },
      createdAt: { type: 'string' }
    }
  };

  const savingsSummarySchema = {
    type: 'object',
    properties: {
      totalSpentEur: { type: 'number' },
      totalSavedVsMsrpEur: { type: 'number' },
      totalSavedVsMedianEur: { type: 'number' },
      totalPurchases: { type: 'number' },
      monthly: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            month: { type: 'string' },
            spentEur: { type: 'number' },
            savedVsMsrpEur: { type: 'number' },
            savedVsMedianEur: { type: 'number' },
            count: { type: 'number' }
          }
        }
      }
    }
  };

  fastify.get('/api/purchases', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          profileId: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'array',
          items: purchaseItemSchema
        },
        500: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    try {
      const { profileId } = request.query as { profileId?: string };
      return purchaseRepo.list(profileId);
    } catch (err: any) {
      request.log.error(err, '[Purchases] Failed to list purchases');
      return reply.status(500).send({ error: `Failed to list purchases: ${err.message}` });
    }
  });

  fastify.post('/api/purchases', {
    schema: {
      response: {
        201: purchaseItemSchema,
        400: errorResponseSchema,
        500: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    const schema = z.object({
      profileId: z.string().optional(),
      gameId: z.string().min(1),
      offerId: z.string().optional(),
      merchantId: z.string().optional(),
      priceEur: z.number().nonnegative(),
      purchasedAt: z.string().optional(),
      notes: z.string().optional()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid purchase data', details: parsed.error.issues });
    }

    let profileId = parsed.data.profileId;
    if (!profileId) {
      const active = profileRepo.getActive();
      profileId = active?.id || 'default';
    }

    try {
      const purchase = purchaseRepo.record({
        ...parsed.data,
        profileId
      });
      return reply.status(201).send(purchase);
    } catch (err: any) {
      return reply.status(500).send({ error: `Failed to record purchase: ${err.message}` });
    }
  });

  fastify.delete('/api/purchases/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } }
        },
        404: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = purchaseRepo.delete(id);
    if (!ok) {
      return reply.status(404).send({ error: 'Purchase not found' });
    }
    return { success: true };
  });

  fastify.get('/api/purchases/savings', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          profileId: { type: 'string' }
        }
      },
      response: {
        200: savingsSummarySchema,
        500: errorResponseSchema
      }
    }
  }, async (request, reply) => {
    try {
      const { profileId } = request.query as { profileId?: string };
      return purchaseRepo.getSavingsSummary(profileId);
    } catch (err: any) {
      request.log.error(err, '[Purchases] Failed to get savings summary');
      return reply.status(500).send({ error: `Failed to get savings summary: ${err.message}` });
    }
  });

  // ----------------------------------------------------
  // CSV Export API (Offline Data Distribution Analysis)
  // ----------------------------------------------------
  fastify.get('/api/export/offers.csv', async (request, reply) => {
    try {
      const activeProfile = profileRepo.getActive();
      if (!activeProfile) {
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', 'attachment; filename="priceSteamTool-offers-export.csv"');
        return 'game_title,merchant_name,merchant_is_official,price_eur,msrp_eur,typical_sale_median_eur,atl_eur,atl_is_confirmed,risk_level,risk_score,risk_flags,is_anomaly,is_best_deal,last_observed_at\r\n';
      }

      const rows = offerRepo.getOffersCsvExportData(activeProfile.id);

      const escapeCsvCell = (val: any): string => {
        if (val === null || val === undefined) return '';
        let str = String(val);
        // Formula injection mitigation (CWE-1236): neutralize spreadsheet formula execution triggers
        if (/^[=+\-@\t\r]/.test(str)) {
          str = `'${str}`;
        }
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const formatRiskFlags = (flags: string | null): string => {
        return flags ? String(flags) : '';
      };

      const lines: string[] = [
        'game_title,merchant_name,merchant_is_official,price_eur,msrp_eur,typical_sale_median_eur,atl_eur,atl_is_confirmed,risk_level,risk_score,risk_flags,is_anomaly,is_best_deal,last_observed_at'
      ];

      for (const r of rows) {
        const line = [
          escapeCsvCell(r.game_title),
          escapeCsvCell(r.merchant_name),
          escapeCsvCell(Boolean(r.merchant_is_official)),
          escapeCsvCell(r.price_eur !== null && r.price_eur !== undefined ? Number(r.price_eur).toFixed(2) : ''),
          escapeCsvCell(r.msrp_eur !== null && r.msrp_eur !== undefined ? Number(r.msrp_eur).toFixed(2) : ''),
          escapeCsvCell(r.typical_sale_median_eur !== null && r.typical_sale_median_eur !== undefined ? Number(r.typical_sale_median_eur).toFixed(2) : ''),
          escapeCsvCell(r.atl_eur !== null && r.atl_eur !== undefined ? Number(r.atl_eur).toFixed(2) : ''),
          escapeCsvCell(r.atl_is_confirmed !== null && r.atl_is_confirmed !== undefined ? Boolean(r.atl_is_confirmed) : ''),
          escapeCsvCell(r.risk_level || 'SAFE'),
          escapeCsvCell(r.risk_score !== null && r.risk_score !== undefined ? Number(r.risk_score).toFixed(2) : '0.00'),
          escapeCsvCell(formatRiskFlags(r.risk_flags)),
          escapeCsvCell(Boolean(r.is_anomaly)),
          escapeCsvCell(Boolean(r.is_best_deal)),
          escapeCsvCell(r.last_observed_at || '')
        ].join(',');
        lines.push(line);
      }

      const csvOutput = lines.join('\r\n') + '\r\n';
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="priceSteamTool-offers-export.csv"');
      return reply.send(csvOutput);
    } catch (err: any) {
      request.log.error(err, '[CSV Export] Failed to export offers CSV');
      return reply.status(500).send({ error: `Failed to export CSV: ${err.message}` });
    }
  });

  // ----------------------------------------------------
  // Discord Notification Settings API
  // ----------------------------------------------------
  fastify.get('/api/settings/discord', async (request) => {
    const { getDiscordSettings } = await import('../domain/discordNotifier.js');
    let isFullAuth = false;
    if (config.apiToken) {
      let rawToken = typeof request.headers['x-api-token'] === 'string'
        ? (request.headers['x-api-token'] as string).trim()
        : '';
      if (!rawToken && typeof request.headers['authorization'] === 'string') {
        const authHeader = (request.headers['authorization'] as string).trim();
        if (authHeader.startsWith('Bearer ')) {
          rawToken = authHeader.slice(7).trim();
        }
      }
      if (rawToken) {
        const clientHash = crypto.createHash('sha256').update(rawToken).digest();
        const expectedHash = crypto.createHash('sha256').update(config.apiToken).digest();
        isFullAuth = crypto.timingSafeEqual(clientHash, expectedHash);
      }
    }
    return getDiscordSettings(!isFullAuth);
  });

  fastify.post('/api/settings/discord', async (request, reply) => {
    const schema = z.object({
      webhookUrl: z.string().optional(),
      isEnabled: z.boolean().optional(),
      minDealScore: z.number().min(0).max(100).optional(),
      minConfidence: z.number().min(0).max(100).optional(),
      notifyAtlOnly: z.boolean().optional(),
      notifyFreeGames: z.boolean().optional(),
      notifyPricingErrors: z.boolean().optional(),
      cooldownHours: z.number().min(1).max(168).optional()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    try {
      const { saveDiscordSettings } = await import('../domain/discordNotifier.js');
      const updated = saveDiscordSettings(parsed.data);
      return updated;
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Failed to save Discord settings' });
    }
  });

  fastify.post('/api/settings/discord/test', async (request, reply) => {
    const schema = z.object({
      webhookUrl: z.string().optional()
    }).optional();

    const parsed = schema.safeParse(request.body);
    const rawOverride = parsed.success ? parsed.data?.webhookUrl : undefined;
    const webhookUrlOverride = rawOverride && !rawOverride.startsWith('...') ? rawOverride : undefined;

    const { sendTestNotification } = await import('../domain/discordNotifier.js');
    const result = await sendTestNotification(webhookUrlOverride);

    if (!result.success) {
      return reply.status(400).send({ error: result.error || 'Failed to send test notification.' });
    }

    return { success: true, message: 'Test message sent to Discord successfully!' };
  });

  // ----------------------------------------------------
  // AllKeyShop Candidate Discovery & Custom Match Override
  // ----------------------------------------------------
  fastify.get('/api/games/:id/allkeyshop-candidates', async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = gameRepo.getById(id);
    if (!game) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    const { allkeyshopAdapter, findCandidateGamesInCatalog, loadCustomMappings } = await import('../sources/allkeyshop.js');
    const mappings = loadCustomMappings();
    const currentOverride = mappings[String(game.steamAppId)] || mappings[game.title] || null;

    let candidates: any[] = [];
    try {
      const catalog = await allkeyshopAdapter.getCatalogForCandidateSearch();
      if (catalog && catalog.length > 0) {
        const catalogIndex = allkeyshopAdapter.getCatalogIndex();
        candidates = findCandidateGamesInCatalog(catalogIndex || catalog, game.title, game.steamAppId, game.releaseDate);
      }
    } catch (err: any) {
      logWarn(`[AllKeyShop] Candidate catalog discovery unavailable for "${game.title}": ${err?.message}`);
    }

    return {
      gameId: game.id,
      title: game.title,
      steamAppId: game.steamAppId,
      currentOverride,
      candidates
    };
  });

  fastify.post('/api/games/:id/allkeyshop-override', async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = gameRepo.getById(id);
    if (!game) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    const schema = z.object({
      override: z.union([z.string(), z.number(), z.null()]).optional()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const { saveCustomMapping, allkeyshopAdapter } = await import('../sources/allkeyshop.js');
    const { normalizeProductType, normalizeRegion } = await import('../domain/normalizer.js');
    const { merchantRepo, offerRepo } = await import('../db/index.js');

    saveCustomMapping(game.steamAppId, parsed.data.override ?? null);

    let staleOffersRemoved = 0;
    if (parsed.data.override !== null && allkeyshopAdapter.isEnabled()) {
      // Background async dispatch: refresh prices without blocking the HTTP response
      setImmediate(async () => {
        try {
          const freshOffers = await allkeyshopAdapter.fetchPricesForGame(
            game.steamAppId, 
            game.title, 
            game.itadId, 
            game.releaseDate
          );
          const freshOfferIds: string[] = [];
          for (const rawOffer of freshOffers) {
            const productNorm = normalizeProductType(rawOffer.productTypeRaw, rawOffer.merchantName);
            if (!productNorm.isValid) continue;
            const regionNorm = normalizeRegion(rawOffer.regionRaw);
            if (!regionNorm.isValid) continue;

            if (!(rawOffer.priceEur > 0) || isNaN(rawOffer.priceEur)) {
              logWarn('Rejected offer with invalid EUR price', {
                gameId: game.id,
                sourceCode: 'allkeyshop',
                rawPrice: rawOffer.rawPrice,
                currency: rawOffer.rawCurrency
              });
              continue;
            }
            const merchant = merchantRepo.getOrCreate(rawOffer.merchantCode, rawOffer.merchantName, rawOffer.isOfficial, rawOffer.dealUrl);
            const savedOffer = offerRepo.upsertOffer({
              gameId: game.id,
              merchantId: merchant.id,
              productType: productNorm.productType,
              regionType: regionNorm.regionType,
              regionCode: regionNorm.regionCode,
              regionConfidence: regionNorm.regionConfidence,
              priceEur: rawOffer.priceEur,
              originalPriceEur: rawOffer.originalPriceEur,
              rawPrice: rawOffer.rawPrice,
              rawCurrency: rawOffer.rawCurrency,
              rawOriginalPrice: rawOffer.rawOriginalPrice,
              voucherCode: rawOffer.voucherCode,
              dealUrl: rawOffer.dealUrl,
              isValid: true,
              sourceCode: 'allkeyshop',
              editionName: rawOffer.editionName
            });
            freshOfferIds.push(savedOffer.id);
          }

          // Drop orphaned AllKeyShop offers from previous (incorrect) match ONLY if fresh offers were retrieved
          if (freshOfferIds.length > 0) {
            const staleRes = offerRepo.invalidateStaleForGameSource(game.id, 'allkeyshop', freshOfferIds);
            if (staleRes.invalidatedCount > 0 || freshOfferIds.length > 0) {
              offerRepo.recomputeBestDealForGame(game.id);
            }
          }
        } catch (err: any) {
          console.warn('Failed to refresh AllKeyShop prices in background after override:', err.message);
        }
      });

      return reply.status(200).send({
        success: true,
        gameId: game.id,
        override: parsed.data.override,
        queued: true,
        offersUpdated: 0,
        staleOffersRemoved: 0
      });
    } else if (parsed.data.override === null) {
      // If override was cleared, invalidate prior AllKeyShop offers for this game
      const staleRes = offerRepo.invalidateStaleForGameSource(game.id, 'allkeyshop', []);
      staleOffersRemoved = staleRes.invalidatedCount;
      if (staleOffersRemoved > 0) {
        offerRepo.recomputeBestDealForGame(game.id);
      }
      return reply.status(200).send({
        success: true,
        gameId: game.id,
        override: null,
        offersUpdated: 0,
        staleOffersRemoved
      });
    }

    return reply.status(200).send({
      success: true,
      gameId: game.id,
      override: parsed.data.override ?? null,
      offersUpdated: 0,
      staleOffersRemoved: 0
    });
  });
};
