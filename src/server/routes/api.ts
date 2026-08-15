import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { 
  profileRepo, 
  gameRepo, 
  offerRepo, 
  sourceRepo, 
  anomalyRepo 
} from '../db/index.js';
import { syncOrchestrator } from '../sync/orchestrator.js';
import { steamAdapter } from '../sources/steam.js';
import type { WishlistFilterOptions, SourceCode } from '../../shared/types.js';

export const apiRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  // ----------------------------------------------------
  // Health & Diagnostics
  // ----------------------------------------------------
  fastify.get('/api/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      syncRunning: syncOrchestrator.isSyncRunning()
    };
  });

  // ----------------------------------------------------
  // Profiles API
  // ----------------------------------------------------
  fastify.get('/api/profiles', async () => {
    return profileRepo.list();
  });

  fastify.post('/api/profiles', async (request, reply) => {
    const schema = z.object({
      name: z.string().min(1),
      steamId: z.string().min(1),
      customUrl: z.string().optional()
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
      resolved.avatarUrl
    );

    return reply.status(201).send(profile);
  });

  fastify.put('/api/profiles/:id/active', async (request, reply) => {
    const { id } = request.params as { id: string };
    profileRepo.setActive(id);
    return { success: true };
  });

  fastify.delete('/api/profiles/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    profileRepo.delete(id);
    return { success: true };
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
      sort: query.sort || 'priority',
      saleOnly: query.saleOnly === 'true' || query.saleOnly === true,
      historicalLowOnly: query.historicalLowOnly === 'true' || query.historicalLowOnly === true,
      underPrice: query.underPrice ? parseFloat(query.underPrice) : undefined,
      merchantType: query.merchantType || 'all',
      hasAnomaly: query.hasAnomaly === 'true' || query.hasAnomaly === true,
      page: query.page ? parseInt(query.page, 10) : 1,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
    };

    const result = gameRepo.getWishlistGames(activeProfile.id, filterOptions);
    return {
      ...result,
      activeProfile,
      page: filterOptions.page,
      limit: filterOptions.limit
    };
  });

  fastify.get('/api/games/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = gameRepo.getById(id);
    if (!game) {
      return reply.status(404).send({ error: 'Game not found' });
    }

    const offers = offerRepo.getOffersForGame(id);
    const history = offerRepo.getPriceHistory(id, 50);

    return {
      game,
      offers,
      history
    };
  });

  // ----------------------------------------------------
  // Synchronization API
  // ----------------------------------------------------
  fastify.post('/api/sync/start', async (request, reply) => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return reply.status(400).send({ error: 'Please create and select an active Steam profile first.' });
    }

    const body = request.body as any;
    const forceRefresh = Boolean(body?.forceRefresh);

    try {
      const progress = await syncOrchestrator.startSync(activeProfile.id, forceRefresh);
      return progress;
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.post('/api/sync/cancel', async () => {
    syncOrchestrator.cancelSync();
    return { success: true };
  });

  fastify.get('/api/sync/status', async () => {
    return syncOrchestrator.getProgress();
  });

  // Server-Sent Events (SSE) for Real-Time Sync Updates
  fastify.get('/api/sync/events', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.flushHeaders();

    const unsubscribe = syncOrchestrator.subscribe((data) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    });

    request.raw.on('close', () => {
      unsubscribe();
    });
  });

  // ----------------------------------------------------
  // Sources & Diagnostics API
  // ----------------------------------------------------
  fastify.get('/api/sources', async () => {
    return sourceRepo.list();
  });

  fastify.post('/api/sources/:code/toggle', async (request, reply) => {
    const { code } = request.params as { code: SourceCode };
    const schema = z.object({ isEnabled: z.boolean() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    sourceRepo.toggle(code, parsed.data.isEnabled);
    return { success: true, code, isEnabled: parsed.data.isEnabled };
  });

  // ----------------------------------------------------
  // Anomalies API
  // ----------------------------------------------------
  fastify.get('/api/anomalies', async () => {
    return anomalyRepo.list();
  });

  fastify.post('/api/anomalies/:id/dismiss', async (request) => {
    const { id } = request.params as { id: string };
    anomalyRepo.dismiss(id);
    return { success: true };
  });
};
