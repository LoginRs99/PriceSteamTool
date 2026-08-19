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
      sort: query.sort || 'best_value',
      saleOnly: query.saleOnly === 'true' || query.saleOnly === true,
      majorDealsOnly: query.majorDealsOnly === 'true' || query.majorDealsOnly === true,
      allTimeLowOnly: query.allTimeLowOnly === 'true' || query.allTimeLowOnly === true || query.historicalLowOnly === 'true' || query.historicalLowOnly === true,
      trustedOnly: query.trustedOnly === 'true' || query.trustedOnly === true,
      isFreeOnly: query.isFreeOnly === 'true' || query.isFreeOnly === true ? true : query.isFreeOnly === 'false' || query.isFreeOnly === false ? false : undefined,
      underPrice: query.underPrice ? parseFloat(query.underPrice) : undefined,
      minPrice: query.minPrice ? parseFloat(query.minPrice) : undefined,
      maxPrice: query.maxPrice ? parseFloat(query.maxPrice) : undefined,
      minDiscount: query.minDiscount ? parseInt(query.minDiscount, 10) : undefined,
      minDealScore: query.minDealScore ? parseInt(query.minDealScore, 10) : undefined,
      minConfidence: query.minConfidence ? parseInt(query.minConfidence, 10) : undefined,
      hideAnomalies: query.hideAnomalies === 'true' || query.hideAnomalies === true,
      hideProvisional: query.hideProvisional === 'true' || query.hideProvisional === true,
      buyOnly: query.buyOnly === 'true' || query.buyOnly === true,
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

  fastify.get('/api/wishlist/statistics', async () => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return {
        totalGames: 0,
        gamesOnSale: 0,
        gamesAtHistoricalLow: 0,
        majorDropsCount: 0,
        gamesWithHighRiskOffers: 0,
        averageDiscountPercent: 0
      };
    }
    return gameRepo.getWishlistStatistics(activeProfile.id);
  });

  // Alias for statistics
  fastify.get('/api/games/statistics', async () => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return {
        totalGames: 0,
        gamesOnSale: 0,
        gamesAtHistoricalLow: 0,
        majorDropsCount: 0,
        gamesWithHighRiskOffers: 0,
        averageDiscountPercent: 0
      };
    }
    return gameRepo.getWishlistStatistics(activeProfile.id);
  });

  fastify.get('/api/wishlist/best-deals', async (request) => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return { deals: [] };
    }
    const query = request.query as any;
    const limit = query.limit ? parseInt(query.limit, 10) : 12;
    const deals = gameRepo.getBestDeals(activeProfile.id, limit);
    return { deals };
  });

  // Alias for best-deals
  fastify.get('/api/games/best-deals', async (request) => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return { deals: [] };
    }
    const query = request.query as any;
    const limit = query.limit ? parseInt(query.limit, 10) : 12;
    const deals = gameRepo.getBestDeals(activeProfile.id, limit);
    return { deals };
  });

  fastify.post('/api/wishlist/:gameId/target-price', async (request, reply) => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      return reply.status(400).send({ error: 'No active profile found' });
    }
    const { gameId } = request.params as { gameId: string };
    const body = request.body as { targetPriceEur?: number | null } | undefined;
    const targetPrice = body?.targetPriceEur !== undefined && body?.targetPriceEur !== null
      ? Math.max(0, Number(body.targetPriceEur))
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

  fastify.get('/api/games/:id/intelligence', async (request, reply) => {
    const { id } = request.params as { id: string };
    const intelligence = gameRepo.getPriceIntelligence(id);
    if (!intelligence) {
      return reply.status(404).send({ error: 'Game not found' });
    }
    return intelligence;
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

  fastify.get('/api/sync/overview', async () => {
    return syncOrchestrator.getSyncStatus();
  });

  // Server-Sent Events (SSE) for Real-Time Sync Updates
  fastify.get('/api/sync/events', async (request, reply) => {
    reply.hijack();
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.flushHeaders();

    const unsubscribe = syncOrchestrator.subscribe((data) => {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        try {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {}
      }
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

  fastify.post('/api/anomalies/dismiss-all', async () => {
    anomalyRepo.dismissAll();
    return { success: true };
  });

  // ----------------------------------------------------
  // CSV Export API (Offline Data Distribution Analysis)
  // ----------------------------------------------------
  fastify.get('/api/export/offers.csv', async (request, reply) => {
    const activeProfile = profileRepo.getActive();
    if (!activeProfile) {
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="priceSteamTool-offers-export.csv"');
      return 'game_title,merchant_name,merchant_is_official,price_eur,msrp_eur,typical_sale_median_eur,atl_eur,atl_is_confirmed,risk_level,risk_score,risk_flags,is_anomaly,is_best_deal,last_observed_at\r\n';
    }

    const rows = offerRepo.getOffersCsvExportData(activeProfile.id);

    const escapeCsvCell = (val: any): string => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const formatRiskFlags = (flagsJson: string | null): string => {
      if (!flagsJson) return '';
      try {
        const parsed = JSON.parse(flagsJson);
        if (Array.isArray(parsed)) {
          return parsed.join(';');
        }
        return String(parsed);
      } catch {
        return String(flagsJson);
      }
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
  });

  // ----------------------------------------------------
  // Discord Notification Settings API
  // ----------------------------------------------------
  fastify.get('/api/settings/discord', async () => {
    const { getDiscordSettings } = await import('../domain/discordNotifier.js');
    return getDiscordSettings();
  });

  fastify.post('/api/settings/discord', async (request, reply) => {
    const schema = z.object({
      webhookUrl: z.string().optional(),
      isEnabled: z.boolean().optional(),
      minDealScore: z.number().min(0).max(100).optional(),
      minConfidence: z.number().min(0).max(100).optional(),
      notifyAtlOnly: z.boolean().optional(),
      notifyFreeGames: z.boolean().optional(),
      cooldownHours: z.number().min(1).max(168).optional()
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const { saveDiscordSettings } = await import('../domain/discordNotifier.js');
    const updated = saveDiscordSettings(parsed.data);
    return updated;
  });

  fastify.post('/api/settings/discord/test', async (request, reply) => {
    const schema = z.object({
      webhookUrl: z.string().optional()
    }).optional();

    const parsed = schema.safeParse(request.body);
    const webhookUrlOverride = parsed.success ? parsed.data?.webhookUrl : undefined;

    const { sendTestNotification } = await import('../domain/discordNotifier.js');
    const result = await sendTestNotification(webhookUrlOverride);

    if (!result.success) {
      return reply.status(400).send({ error: result.error || 'Failed to send test notification.' });
    }

    return { success: true, message: 'Test message sent to Discord successfully!' };
  });
};
