import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { 
  profileRepo, 
  gameRepo, 
  offerRepo, 
  merchantRepo 
} from '../db/index.js';
import { syncOrchestrator } from '../sync/orchestrator.js';
import type { Game, Offer, PriceHistoryEntry } from '../../shared/types.js';

function resolveGame(id: string): Game | null {
  if (id.startsWith('steam:')) {
    const appId = parseInt(id.replace('steam:', ''), 10);
    return !isNaN(appId) ? gameRepo.getBySteamAppId(appId) : null;
  }
  if (/^\d+$/.test(id)) {
    const byAppId = gameRepo.getBySteamAppId(parseInt(id, 10));
    if (byAppId) return byAppId;
  }
  return gameRepo.getById(id);
}

export const v1Routes: FastifyPluginAsync = async (fastify) => {

  // Standard IETF & Custom RateLimit and Diagnostics Headers Hook for /api/v1/*
  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-RateLimit-Limit', '300');
    reply.header('X-RateLimit-Remaining', '299');
    reply.header('X-RateLimit-Reset', '60');
    reply.header('X-API-Version', '1.0');
    reply.header('RateLimit-Limit', '300');
    reply.header('RateLimit-Remaining', '299');
    reply.header('RateLimit-Reset', '60');
    return payload;
  });

  // ----------------------------------------------------
  // 1. Catalog & Games
  // ----------------------------------------------------

  // GET /api/v1/games
  fastify.get('/api/v1/games', async (request, reply) => {
    const query = request.query as any;
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(250, Math.max(1, parseInt(query.limit || '50', 10)));
    const search = query.q || query.search || undefined;
    const steamAppId = query.steam_app_id ? parseInt(query.steam_app_id, 10) : undefined;

    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return { data: [], pagination: { total: 0, page, limit, totalPages: 0 } };
    }

    const { games, total } = gameRepo.getWishlistGames(activeProfile.id, {
      search,
      page,
      limit
    });

    const filtered = steamAppId ? games.filter(g => g.steamAppId === steamAppId) : games;
    const totalCount = steamAppId ? filtered.length : total;

    // Generate simple ETag from latest update times
    const latestUpdate = filtered.reduce((latest, g) => (g.updatedAt > latest ? g.updatedAt : latest), '');
    const etag = `W/"games-${totalCount}-${latestUpdate}"`;
    reply.header('ETag', etag);

    if (request.headers['if-none-match'] === etag) {
      return reply.status(304).send();
    }

    return {
      data: filtered.map(g => ({
        id: g.id,
        steamAppId: g.steamAppId,
        title: g.title,
        slug: g.slug,
        basePriceEur: g.basePriceEur ?? null,
        historicalLowEur: g.historicalLowEur ?? null,
        historicalLowDate: g.historicalLowDate ?? null,
        releaseDate: g.releaseDate ?? null,
        updatedAt: g.updatedAt,
        offersCount: g.offersCount ?? 0,
        bestPriceEur: g.bestPriceEur ?? null
      })),
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    };
  });

  // GET /api/v1/games/:id
  fastify.get('/api/v1/games/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = resolveGame(id);

    if (!game) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    return {
      id: game.id,
      steamAppId: game.steamAppId,
      title: game.title,
      slug: game.slug,
      basePriceEur: game.basePriceEur ?? null,
      historicalLowEur: game.historicalLowEur ?? null,
      historicalLowDate: game.historicalLowDate ?? null,
      historicalLowMerchant: game.historicalLowSource ?? null,
      activeOffersCount: game.offersCount ?? 0,
      bestPriceEur: game.bestPriceEur ?? null,
      bestMerchantName: game.bestMerchantName ?? null,
      bestDealScore: game.bestDealScore ?? null,
      riskLevel: game.bestRiskLevel ?? 'SAFE'
    };
  });

  // POST /api/v1/games/:id/refresh
  fastify.post('/api/v1/games/:id/refresh', async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = resolveGame(id);

    if (!game) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    const schema = z.object({
      includeKeyshops: z.boolean().optional()
    }).optional();

    const parsed = schema.safeParse(request.body);
    const includeKeyshops = parsed.success && parsed.data?.includeKeyshops !== undefined 
      ? parsed.data.includeKeyshops 
      : true;

    try {
      const result = await syncOrchestrator.refreshGame(game.id, { includeKeyshops });
      return result;
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // POST /api/v1/games/resolve
  fastify.post('/api/v1/games/resolve', async (request, reply) => {
    const schema = z.object({
      steamAppIds: z.array(z.number().int().positive()).max(200).optional(),
      titles: z.array(z.string().min(1)).max(200).optional()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const result = gameRepo.resolveGames({
      steamAppIds: parsed.data.steamAppIds,
      titles: parsed.data.titles
    });

    return result;
  });

  // ----------------------------------------------------
  // 2. Offers & Live Prices (Batch & Anti-Rate-Limit)
  // ----------------------------------------------------

  // GET /api/v1/games/:id/offers
  fastify.get('/api/v1/games/:id/offers', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as any;
    const onlyOfficial = query.official_only === 'true' || query.official_only === true;
    const game = resolveGame(id);

    if (!game) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    let offers = offerRepo.getOffersForGame(game.id);
    if (onlyOfficial) {
      offers = offers.filter(o => o.isOfficial);
    }

    const bestDeal = offers.find(o => o.isBestDeal) || offers[0] || null;

    return {
      gameId: game.id,
      steamAppId: game.steamAppId,
      currency: 'EUR',
      bestDeal: bestDeal ? {
        merchantId: bestDeal.merchantId,
        merchantName: bestDeal.merchantName,
        isOfficial: bestDeal.isOfficial,
        price: bestDeal.priceEur,
        voucherCode: bestDeal.voucherCode ?? null,
        productType: bestDeal.productType,
        region: bestDeal.regionType,
        dealUrl: bestDeal.dealUrl,
        dealScore: bestDeal.dealScore,
        riskLevel: bestDeal.riskLevel,
        lastObservedAt: bestDeal.lastObservedAt
      } : null,
      offers: offers.map(o => ({
        merchantId: o.merchantId,
        merchantName: o.merchantName,
        isOfficial: o.isOfficial,
        price: o.priceEur,
        discountPercent: o.discountPercent ?? null,
        productType: o.productType,
        region: o.regionType,
        dealUrl: o.dealUrl,
        dealScore: o.dealScore,
        riskLevel: o.riskLevel,
        lastObservedAt: o.lastObservedAt
      }))
    };
  });

  // POST /api/v1/offers/batch
  fastify.post('/api/v1/offers/batch', async (request, reply) => {
    const schema = z.object({
      steamAppIds: z.array(z.number().int().positive()).min(1).max(250),
      currency: z.string().default('EUR'),
      region: z.string().default('GLOBAL'),
      includeAllOffers: z.boolean().default(false),
      onlyOfficial: z.boolean().default(false)
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const { results, fetchedAt } = offerRepo.getBatchOffers(parsed.data.steamAppIds, {
      onlyOfficial: parsed.data.onlyOfficial,
      includeAllOffers: parsed.data.includeAllOffers
    });

    return {
      currency: parsed.data.currency,
      fetchedAt,
      results
    };
  });

  // GET /api/v1/games/:id/history
  fastify.get('/api/v1/games/:id/history', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as any;
    const limit = Math.min(365, Math.max(1, parseInt(query.days || '90', 10)));

    const game = resolveGame(id);

    if (!game) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    const history = offerRepo.getPriceHistory(game.id, limit);

    return {
      gameId: game.id,
      steamAppId: game.steamAppId,
      currency: 'EUR',
      historicalLow: {
        priceEur: game.historicalLowEur ?? null,
        merchant: game.historicalLowSource ?? null,
        recordedAt: game.historicalLowDate ?? null
      },
      history: history.map(h => ({
        priceEur: h.priceEur,
        merchant: h.merchantName,
        isOfficial: h.isOfficial,
        discountPercent: h.discountPercent ?? null,
        priceEvent: h.priceEvent ?? null,
        dealScore: h.dealScore ?? null,
        recordedAt: h.recordedAt
      }))
    };
  });

  // ----------------------------------------------------
  // 3. Merchants & Stores
  // ----------------------------------------------------

  // GET /api/v1/merchants
  fastify.get('/api/v1/merchants', async (request, reply) => {
    const list = merchantRepo.list();
    const etag = `W/"merchants-${list.length}"`;
    reply.header('ETag', etag);

    if (request.headers['if-none-match'] === etag) {
      return reply.status(304).send();
    }

    return { data: list };
  });

  // GET /api/v1/merchants/:id
  fastify.get('/api/v1/merchants/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const list = merchantRepo.list();
    const found = list.find(m => m.id === id || m.code === id);
    if (!found) {
      return reply.status(404).send({ error: 'Merchant not found' });
    }
    return found;
  });

  // ----------------------------------------------------
  // 4. Price Alerts & Push Triggers
  // ----------------------------------------------------

  // GET /api/v1/alerts
  fastify.get('/api/v1/alerts', async () => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return { data: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 0 } };
    }

    const games = gameRepo.getAllWishlistGameIds(activeProfile.id);
    const withAlerts = games.filter(g => g.targetPriceEur !== undefined && g.targetPriceEur !== null);

    return {
      data: withAlerts.map(g => ({
        gameId: g.id,
        steamAppId: g.steamAppId,
        title: g.title,
        targetPriceEur: g.targetPriceEur,
        status: 'ACTIVE'
      })),
      pagination: {
        total: withAlerts.length,
        page: 1,
        limit: 50,
        totalPages: 1
      }
    };
  });

  // POST /api/v1/alerts
  fastify.post('/api/v1/alerts', async (request, reply) => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return reply.status(400).send({ error: 'No active profile found' });
    }

    const schema = z.object({
      gameId: z.string().optional(),
      steamAppId: z.number().int().positive().optional(),
      targetPriceEur: z.number().positive().nullable()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    let targetGameId = parsed.data.gameId;
    if (!targetGameId && parsed.data.steamAppId) {
      const g = gameRepo.getBySteamAppId(parsed.data.steamAppId);
      targetGameId = g?.id;
    }

    if (!targetGameId) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    gameRepo.setTargetPrice(activeProfile.id, targetGameId, parsed.data.targetPriceEur);
    return reply.status(201).send({
      gameId: targetGameId,
      targetPriceEur: parsed.data.targetPriceEur,
      status: 'ACTIVE'
    });
  });

  // DELETE /api/v1/alerts/:id
  fastify.delete('/api/v1/alerts/:id', async (request, reply) => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return reply.status(400).send({ error: 'No active profile found' });
    }

    const { id } = request.params as { id: string };
    gameRepo.setTargetPrice(activeProfile.id, id, null);

    return { success: true, deletedAlertId: id };
  });

  // ----------------------------------------------------
  // 5. Quota & Diagnostics
  // ----------------------------------------------------

  // GET /api/v1/quota
  fastify.get('/api/v1/quota', async () => {
    return {
      tier: 'SELF_HOSTED',
      status: 'HEALTHY',
      rateLimitPerMinute: 300,
      currentWindowRemaining: 299,
      windowResetSeconds: 60,
      timestamp: new Date().toISOString()
    };
  });
};
