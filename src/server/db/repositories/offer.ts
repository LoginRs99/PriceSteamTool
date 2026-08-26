import { randomUUID } from 'crypto';
import { getDb, prepareStmt, BEST_DEAL_RECOMPUTE_ALL_SQL } from '../core.js';
import { gameRepo } from './game.js';
import { anomalyRepo } from './anomaly.js';
import { evaluatePriceMovement, type PriceEvaluationInput } from '../../domain/pricingEngine.js';
import { calculateDealScore } from '../../domain/dealScore.js';
import { calculateTypicalSalePrice, calculatePeriodLows } from '../../domain/priceIntelligence.js';
import type { 
  Game, 
  Offer, 
  SourceCode, 
  PriceHistoryEntry 
} from '../../../shared/types.js';

export const offerRepo = {
  upsertOffer(data: {
    gameId: string;
    merchantId: string;
    productType: string;
    regionType: string;
    regionCode?: string;
    regionConfidence?: number;
    priceEur: number;
    originalPriceEur?: number;
    rawPrice?: number;
    rawCurrency?: string;
    rawOriginalPrice?: number;
    discountPercent?: number;
    voucherCode?: string;
    dealUrl: string;
    isValid?: boolean;
    sourceCode: SourceCode;
    rawObservationJson?: string;
  }): Offer {
    const db = getDb();
    const now = new Date().toISOString();
    const discount = data.discountPercent !== undefined ? data.discountPercent : 
      (data.originalPriceEur && data.originalPriceEur > data.priceEur 
        ? Math.round(((data.originalPriceEur - data.priceEur) / data.originalPriceEur) * 100) 
        : 0);

    const tx = db.transaction(() => {
      let offerId: string;
      const existing = prepareStmt(`
        SELECT id, price_eur FROM offers 
        WHERE game_id = ? AND merchant_id = ? AND product_type = ? AND region_type = ?
      `).get(data.gameId, data.merchantId, data.productType, data.regionType) as any;

      // 1. Gather context for 2D pricing engine
      const gameInfo = prepareStmt(`SELECT * FROM games WHERE id = ?`).get(data.gameId) as any;
      const merchantInfo = prepareStmt(`SELECT name, is_official, trust_score FROM merchants WHERE id = ?`).get(data.merchantId) as any;
      
      const otherPricesRows = prepareStmt(`SELECT price_eur FROM offers WHERE game_id = ? AND is_valid = 1 AND merchant_id != ?`).all(data.gameId, data.merchantId) as any[];
      const marketPrices = otherPricesRows.map(p => Number(p.price_eur));

      let sourceCount = 1;
      if (existing) {
        const obsCountRow = prepareStmt(`SELECT COUNT(DISTINCT source_code) as c FROM source_observations WHERE offer_id = ?`).get(existing.id) as any;
        const alreadyHasThisSource = prepareStmt(`SELECT 1 FROM source_observations WHERE offer_id = ? AND source_code = ?`).get(existing.id, data.sourceCode);
        sourceCount = (obsCountRow?.c || 0) + (alreadyHasThisSource ? 0 : 1);
      }

      const sourceHistoryRows = prepareStmt(`
        SELECT price_eur FROM price_history 
        WHERE game_id = ? AND merchant_id = ? 
        ORDER BY recorded_at ASC
      `).all(data.gameId, data.merchantId) as any[];
      const sourceHistory = sourceHistoryRows.map(r => Number(r.price_eur));

      const lastHistory = prepareStmt(`
        SELECT price_eur, discount_percent FROM price_history 
        WHERE game_id = ? AND merchant_id = ? 
        ORDER BY recorded_at DESC LIMIT 1
      `).get(data.gameId, data.merchantId) as any;

      const evalInput: PriceEvaluationInput = {
        currentPriceEur: data.priceEur,
        originalPriceEur: data.originalPriceEur,
        basePriceEur: gameInfo?.base_price_eur ? Number(gameInfo.base_price_eur) : undefined,
        historicalLowEur: gameInfo?.historical_low_eur ? Number(gameInfo.historical_low_eur) : undefined,
        previousPriceEur: lastHistory?.price_eur ? Number(lastHistory.price_eur) : undefined,
        marketPricesEur: marketPrices,
        sourceHistoryEur: sourceHistory,
        sourceAgreementCount: Math.max(1, sourceCount),
        isOfficialMerchant: merchantInfo ? Boolean(merchantInfo.is_official) : true,
        merchantTrustScore: merchantInfo?.trust_score ? Number(merchantInfo.trust_score) : 1.0,
        gameReleaseDate: gameInfo?.release_date || undefined
      };

      const pricingEval = evaluatePriceMovement(evalInput);

      if (existing) {
        offerId = existing.id;
        prepareStmt(`
          UPDATE offers
          SET price_eur = ?,
              original_price_eur = COALESCE(?, original_price_eur),
              raw_price = COALESCE(?, raw_price),
              raw_currency = COALESCE(?, raw_currency),
              raw_original_price = COALESCE(?, raw_original_price),
              discount_percent = ?,
              voucher_code = COALESCE(?, voucher_code),
              deal_url = ?,
              is_valid = ?,
              price_event = ?,
              risk_level = ?,
              risk_score = ?,
              risk_flags = ?,
              evaluation_confidence = ?,
              is_anomaly = ?,
              anomaly_score = ?,
              anomaly_reason = ?,
              region_confidence = ?,
              last_observed_at = ?,
              fetched_at = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          data.priceEur,
          data.originalPriceEur || null,
          data.rawPrice !== undefined ? data.rawPrice : null,
          data.rawCurrency || null,
          data.rawOriginalPrice !== undefined ? data.rawOriginalPrice : null,
          discount,
          data.voucherCode || null,
          data.dealUrl,
          data.isValid !== false ? 1 : 0,
          pricingEval.event,
          pricingEval.riskLevel,
          pricingEval.riskScore,
          JSON.stringify(pricingEval.riskFlags),
          pricingEval.confidence,
          pricingEval.isAnomaly ? 1 : 0,
          pricingEval.riskScore,
          pricingEval.summary,
          data.regionConfidence !== undefined ? data.regionConfidence : 1.0,
          now,
          now,
          now,
          offerId
        );
      } else {
        offerId = randomUUID();
        prepareStmt(`
          INSERT INTO offers (
            id, game_id, merchant_id, product_type, region_type, region_code, region_confidence,
            price_eur, original_price_eur, raw_price, raw_currency, raw_original_price,
            discount_percent, voucher_code, deal_url,
            is_best_deal, is_valid, price_event, risk_level, risk_score, risk_flags, evaluation_confidence,
            is_anomaly, anomaly_score, anomaly_reason, fetched_at, last_observed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          offerId,
          data.gameId,
          data.merchantId,
          data.productType,
          data.regionType,
          data.regionCode || null,
          data.regionConfidence !== undefined ? data.regionConfidence : 1.0,
          data.priceEur,
          data.originalPriceEur || null,
          data.rawPrice !== undefined ? data.rawPrice : null,
          data.rawCurrency || 'EUR',
          data.rawOriginalPrice !== undefined ? data.rawOriginalPrice : null,
          discount,
          data.voucherCode || null,
          data.dealUrl,
          data.isValid !== false ? 1 : 0,
          pricingEval.event,
          pricingEval.riskLevel,
          pricingEval.riskScore,
          JSON.stringify(pricingEval.riskFlags),
          pricingEval.confidence,
          pricingEval.isAnomaly ? 1 : 0,
          pricingEval.riskScore,
          pricingEval.summary,
          now,
          now,
          now,
          now
        );
      }

      // If a verified new historical low occurred, update game record
      if (pricingEval.event === 'NEW_HISTORICAL_LOW') {
        gameRepo.updateHistoricalLow(data.gameId, data.priceEur, now, data.sourceCode);
      }

      // Record / update source observation
      const obsId = randomUUID();
      prepareStmt(`
        INSERT INTO source_observations (id, offer_id, source_code, observed_price_eur, observed_raw_price, observed_currency, observed_at, raw_data_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(offer_id, source_code) DO UPDATE SET
          observed_price_eur = excluded.observed_price_eur,
          observed_raw_price = COALESCE(excluded.observed_raw_price, source_observations.observed_raw_price),
          observed_currency = COALESCE(excluded.observed_currency, source_observations.observed_currency),
          observed_at = excluded.observed_at,
          raw_data_json = excluded.raw_data_json
      `).run(
        obsId, 
        offerId, 
        data.sourceCode, 
        data.priceEur, 
        data.rawPrice !== undefined ? data.rawPrice : null,
        data.rawCurrency || 'EUR',
        now, 
        data.rawObservationJson || null
      );

      // Record price history only if price or discount actually changed (Idempotent tracking)
      const hasPriceChanged = !lastHistory || 
        Math.abs(Number(lastHistory.price_eur) - data.priceEur) >= 0.005 || 
        Number(lastHistory.discount_percent || 0) !== discount;

      if (hasPriceChanged) {
        // Fetch raw history to compute typical sale price and period lows
        const rawHistory = prepareStmt(`
          SELECT * FROM price_history WHERE game_id = ? ORDER BY recorded_at DESC
        `).all(data.gameId) as any[];

        const history: PriceHistoryEntry[] = rawHistory.map(h => ({
          id: h.id,
          gameId: h.game_id,
          merchantId: h.merchant_id,
          merchantName: '',
          merchantCode: '',
          isOfficial: true,
          sourceCode: h.source_code as SourceCode,
          priceEur: Number(h.price_eur),
          discountPercent: Number(h.discount_percent || 0),
          priceEvent: h.price_event || 'NONE',
          dealScore: h.deal_score ? Number(h.deal_score) : undefined,
          recordedAt: h.recorded_at
        }));

        const currentObservation: PriceHistoryEntry = {
          id: 'temp',
          gameId: data.gameId,
          merchantId: data.merchantId,
          merchantName: merchantInfo?.name || '',
          isOfficial: Boolean(merchantInfo?.is_official),
          sourceCode: data.sourceCode,
          priceEur: data.priceEur,
          discountPercent: discount,
          priceEvent: pricingEval.event,
          recordedAt: now
        };

        const fullHistory = [currentObservation, ...history];
        const basePrice = gameInfo?.base_price_eur ? Number(gameInfo.base_price_eur) : undefined;
        const typicalSale = calculateTypicalSalePrice(basePrice, fullHistory);

        const mappedGame: Game = {
          id: gameInfo.id,
          steamAppId: Number(gameInfo.steam_app_id),
          title: gameInfo.title,
          slug: gameInfo.slug,
          basePriceEur: basePrice,
          historicalLowEur: gameInfo.historical_low_eur ? Number(gameInfo.historical_low_eur) : undefined,
          historicalLowDate: gameInfo.historical_low_date || undefined,
          historicalLowSource: gameInfo.historical_low_source || undefined,
          isDlc: Boolean(gameInfo.is_dlc),
          isFree: Boolean(gameInfo.is_free),
          hasAnomaly: false,
          offersCount: 1,
          createdAt: gameInfo.created_at,
          updatedAt: gameInfo.updated_at
        };

        const periodLows = calculatePeriodLows(mappedGame, fullHistory, {
          id: offerId,
          gameId: data.gameId,
          merchantId: data.merchantId,
          merchantName: merchantInfo?.name || '',
          merchantCode: merchantInfo?.code || '',
          isOfficial: Boolean(merchantInfo?.is_official),
          productType: (data.productType as any) || 'DIRECT_PURCHASE',
          regionType: (data.regionType as any) || 'GLOBAL',
          regionConfidence: data.regionConfidence ?? 1.0,
          priceEur: data.priceEur,
          discountPercent: discount,
          dealUrl: data.dealUrl,
          isBestDeal: true,
          isValid: true,
          priceEvent: pricingEval.event,
          riskLevel: pricingEval.riskLevel,
          riskScore: pricingEval.riskScore,
          riskFlags: pricingEval.riskFlags,
          evaluationConfidence: pricingEval.confidence,
          isAnomaly: pricingEval.isAnomaly,
          sources: [data.sourceCode],
          sourceAgreementCount: 1,
          fetchedAt: now,
          lastObservedAt: now,
          createdAt: now,
          updatedAt: now
        });

        const atlConfirmed = periodLows.allTimeLow.isConfirmed ? 1 : 0;
        const atlSingleSource = (periodLows.allTimeLow.isConfirmed === false || Boolean(periodLows.low90d.isSingleSourceLow)) ? 1 : 0;

        // Cache the statistical metrics on the games table
        prepareStmt(`
          UPDATE games SET
            typical_sale_median_eur = ?,
            typical_sale_q1_eur = ?,
            typical_sale_q3_eur = ?,
            typical_sale_sample_count = ?,
            typical_sale_low_confidence = ?,
            low_90d_eur = ?,
            low_1y_eur = ?,
            atl_is_confirmed = ?,
            atl_is_single_source_low = ?,
            price_tracking_first_observed_at = COALESCE(price_tracking_first_observed_at, ?),
            best_offer_source_count = ?,
            deal_score_stats_updated_at = ?
          WHERE id = ?
        `).run(
          typicalSale.medianPriceEur,
          typicalSale.q1PriceEur ?? null,
          typicalSale.q3PriceEur ?? null,
          typicalSale.sampleCount,
          typicalSale.isLowConfidence ? 1 : 0,
          periodLows.low90d.priceEur,
          periodLows.low1y.priceEur,
          atlConfirmed,
          atlSingleSource,
          now,
          Math.max(1, sourceCount),
          now,
          data.gameId
        );

        const dealCalc = calculateDealScore({
          priceEur: data.priceEur,
          basePriceEur: basePrice,
          typicalSaleMedianEur: typicalSale.medianPriceEur,
          typicalSaleQ1Eur: typicalSale.q1PriceEur,
          typicalSaleQ3Eur: typicalSale.q3PriceEur,
          isLowSample: typicalSale.isLowConfidence || typicalSale.medianPriceEur === null,
          low90dEur: periodLows.low90d.priceEur,
          low1yEur: periodLows.low1y.priceEur,
          allTimeLowEur: periodLows.allTimeLow.priceEur || (gameInfo?.historical_low_eur ? Number(gameInfo.historical_low_eur) : undefined),
          historicalLowEur: periodLows.allTimeLow.priceEur || (gameInfo?.historical_low_eur ? Number(gameInfo.historical_low_eur) : undefined),
          isConfirmedAtl: periodLows.allTimeLow.isConfirmed,
          isSingleSourceLow: Boolean(periodLows.allTimeLow.isConfirmed === false || periodLows.low90d.isSingleSourceLow),
          isAnomaly: pricingEval.isAnomaly,
          riskLevel: pricingEval.riskLevel
        });

        prepareStmt(`
          INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, discount_percent, price_event, deal_score, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), data.gameId, data.merchantId, data.sourceCode, data.priceEur, discount, pricingEval.event, dealCalc.score, now);
      }

      // Recalculate best deal for this game
      offerRepo.recomputeBestDealForGame(data.gameId);

      // Manage genuine anomalies & HIGH risk detections in the anomalies table (Data Safety audit trail)
      if (pricingEval.isAnomaly || pricingEval.riskLevel === 'HIGH') {
        const anomalyType = (pricingEval.riskFlags && pricingEval.riskFlags[0])
          ? pricingEval.riskFlags[0]
          : 'PRICE_ANOMALY';
        anomalyRepo.record(data.gameId, offerId, anomalyType, pricingEval.riskScore, pricingEval.summary);
      }

      return offerId;
    });

    const offerId = tx();
    return this.getById(offerId)!;
  },

  getById(id: string): Offer | null {
    const r = prepareStmt(`
      SELECT o.*, m.name as merchant_name, m.code as merchant_code, m.is_official, m.trust_score,
             g.base_price_eur, g.historical_low_eur, g.typical_sale_median_eur, g.typical_sale_q1_eur,
             g.typical_sale_q3_eur, g.typical_sale_low_confidence, g.low_90d_eur, g.low_1y_eur,
             g.atl_is_confirmed, g.atl_is_single_source_low
      FROM offers o
      JOIN merchants m ON o.merchant_id = m.id
      LEFT JOIN games g ON o.game_id = g.id
      WHERE o.id = ?
    `).get(id) as any;

    if (!r) return null;

    const sources = prepareStmt(`
      SELECT source_code FROM source_observations WHERE offer_id = ?
    `).all(id) as any[];

    let riskFlags: any[] = [];
    if (r.risk_flags) {
      try { riskFlags = JSON.parse(r.risk_flags); } catch {}
    }

    const isOfficial = Boolean(r.is_official);
    const isConfirmedAtl = r.atl_is_confirmed !== null && r.atl_is_confirmed !== undefined
      ? Boolean(r.atl_is_confirmed)
      : true;
    const isSingleSourceLow = r.atl_is_single_source_low !== null && r.atl_is_single_source_low !== undefined
      ? Boolean(r.atl_is_single_source_low)
      : false;

    const dealCalc = calculateDealScore({
      priceEur: Number(r.price_eur),
      basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
      typicalSaleMedianEur: r.typical_sale_median_eur !== null && r.typical_sale_median_eur !== undefined ? Number(r.typical_sale_median_eur) : null,
      typicalSaleQ1Eur: r.typical_sale_q1_eur !== null && r.typical_sale_q1_eur !== undefined ? Number(r.typical_sale_q1_eur) : undefined,
      typicalSaleQ3Eur: r.typical_sale_q3_eur !== null && r.typical_sale_q3_eur !== undefined ? Number(r.typical_sale_q3_eur) : undefined,
      isLowSample: Boolean(r.typical_sale_low_confidence || r.typical_sale_median_eur === null || r.typical_sale_median_eur === undefined),
      low90dEur: r.low_90d_eur !== null && r.low_90d_eur !== undefined ? Number(r.low_90d_eur) : null,
      low1yEur: r.low_1y_eur !== null && r.low_1y_eur !== undefined ? Number(r.low_1y_eur) : null,
      allTimeLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
      historicalLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
      isConfirmedAtl,
      isSingleSourceLow,
      isAnomaly: Boolean(r.is_anomaly),
      riskLevel: r.risk_level || 'SAFE'
    });

    return {
      id: r.id,
      gameId: r.game_id,
      merchantId: r.merchant_id,
      merchantName: r.merchant_name,
      merchantCode: r.merchant_code,
      isOfficial,
      productType: r.product_type,
      regionType: r.region_type,
      regionCode: r.region_code || undefined,
      regionConfidence: Number(r.region_confidence),
      priceEur: Number(r.price_eur),
      originalPriceEur: r.original_price_eur ? Number(r.original_price_eur) : undefined,
      rawPrice: r.raw_price !== null && r.raw_price !== undefined ? Number(r.raw_price) : undefined,
      rawCurrency: r.raw_currency || undefined,
      rawOriginalPrice: r.raw_original_price !== null && r.raw_original_price !== undefined ? Number(r.raw_original_price) : undefined,
      discountPercent: Number(r.discount_percent),
      voucherCode: r.voucher_code || undefined,
      dealUrl: r.deal_url,
      isBestDeal: Boolean(r.is_best_deal),
      isValid: Boolean(r.is_valid),
      priceEvent: r.price_event || 'NONE',
      riskLevel: r.risk_level || 'SAFE',
      riskScore: Number(r.risk_score || 0),
      riskFlags,
      evaluationConfidence: Number(r.evaluation_confidence || 1.0),
      isAnomaly: Boolean(r.is_anomaly),
      anomalyReason: r.anomaly_reason || undefined,
      dealScore: dealCalc.score,
      dealTier: dealCalc.tier,
      confidenceScore: dealCalc.confidenceScore,
      confidenceTier: dealCalc.confidenceTier,
      isProvisional: dealCalc.isProvisional,
      sources: sources.map(s => s.source_code as SourceCode),
      sourceAgreementCount: sources.length,
      fetchedAt: r.fetched_at,
      lastObservedAt: r.last_observed_at || r.fetched_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  },

  getOffersForGame(gameId: string): Offer[] {
    const rows = prepareStmt(`
      SELECT o.*, m.name as merchant_name, m.code as merchant_code, m.is_official, m.trust_score,
             g.base_price_eur, g.historical_low_eur, g.typical_sale_median_eur, g.typical_sale_q1_eur,
             g.typical_sale_q3_eur, g.typical_sale_low_confidence, g.low_90d_eur, g.low_1y_eur,
             g.atl_is_confirmed, g.atl_is_single_source_low
      FROM offers o
      JOIN merchants m ON o.merchant_id = m.id
      LEFT JOIN games g ON o.game_id = g.id
      WHERE o.game_id = ?
      ORDER BY o.is_valid DESC, o.price_eur ASC
    `).all(gameId) as any[];

    return rows.map(r => {
      const sources = prepareStmt(`
        SELECT source_code FROM source_observations WHERE offer_id = ?
      `).all(r.id) as any[];

      let riskFlags: any[] = [];
      if (r.risk_flags) {
        try { riskFlags = JSON.parse(r.risk_flags); } catch {}
      }

      const isOfficial = Boolean(r.is_official);
      const isConfirmedAtl = r.atl_is_confirmed !== null && r.atl_is_confirmed !== undefined
        ? Boolean(r.atl_is_confirmed)
        : true;
      const isSingleSourceLow = r.atl_is_single_source_low !== null && r.atl_is_single_source_low !== undefined
        ? Boolean(r.atl_is_single_source_low)
        : false;

      const dealCalc = calculateDealScore({
        priceEur: Number(r.price_eur),
        basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
        typicalSaleMedianEur: r.typical_sale_median_eur !== null && r.typical_sale_median_eur !== undefined ? Number(r.typical_sale_median_eur) : null,
        typicalSaleQ1Eur: r.typical_sale_q1_eur !== null && r.typical_sale_q1_eur !== undefined ? Number(r.typical_sale_q1_eur) : undefined,
        typicalSaleQ3Eur: r.typical_sale_q3_eur !== null && r.typical_sale_q3_eur !== undefined ? Number(r.typical_sale_q3_eur) : undefined,
        isLowSample: Boolean(r.typical_sale_low_confidence || r.typical_sale_median_eur === null || r.typical_sale_median_eur === undefined),
        low90dEur: r.low_90d_eur !== null && r.low_90d_eur !== undefined ? Number(r.low_90d_eur) : null,
        low1yEur: r.low_1y_eur !== null && r.low_1y_eur !== undefined ? Number(r.low_1y_eur) : null,
        allTimeLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
        historicalLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
        isConfirmedAtl,
        isSingleSourceLow,
        isAnomaly: Boolean(r.is_anomaly),
        riskLevel: r.risk_level || 'SAFE'
      });

      return {
        id: r.id,
        gameId: r.game_id,
        merchantId: r.merchant_id,
        merchantName: r.merchant_name,
        merchantCode: r.merchant_code,
        isOfficial,
        productType: r.product_type,
        regionType: r.region_type,
        regionCode: r.region_code || undefined,
        regionConfidence: Number(r.region_confidence),
        priceEur: Number(r.price_eur),
        originalPriceEur: r.original_price_eur ? Number(r.original_price_eur) : undefined,
        rawPrice: r.raw_price !== null && r.raw_price !== undefined ? Number(r.raw_price) : undefined,
        rawCurrency: r.raw_currency || undefined,
        rawOriginalPrice: r.raw_original_price !== null && r.raw_original_price !== undefined ? Number(r.raw_original_price) : undefined,
        discountPercent: Number(r.discount_percent),
        voucherCode: r.voucher_code || undefined,
        dealUrl: r.deal_url,
        isBestDeal: Boolean(r.is_best_deal),
        isValid: Boolean(r.is_valid),
        priceEvent: r.price_event || 'NONE',
        riskLevel: r.risk_level || 'SAFE',
        riskScore: Number(r.risk_score || 0),
        riskFlags,
        evaluationConfidence: Number(r.evaluation_confidence || 1.0),
        isAnomaly: Boolean(r.is_anomaly),
        anomalyReason: r.anomaly_reason || undefined,
        dealScore: dealCalc.score,
        dealTier: dealCalc.tier,
        sources: sources.map(s => s.source_code as SourceCode),
        sourceAgreementCount: sources.length,
        fetchedAt: r.fetched_at,
        lastObservedAt: r.last_observed_at || r.fetched_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      };
    });
  },

  recomputeBestDealForGame(gameId: string): void {
    prepareStmt(`UPDATE offers SET is_best_deal = 0 WHERE game_id = ?`).run(gameId);

    const best = prepareStmt(`
      SELECT id FROM offers 
      WHERE game_id = ? AND is_valid = 1 
      ORDER BY 
        CASE WHEN is_anomaly = 1 OR risk_level = 'HIGH' THEN 1 ELSE 0 END ASC,
        price_eur ASC 
      LIMIT 1
    `).get(gameId) as any;

    if (best) {
      prepareStmt(`UPDATE offers SET is_best_deal = 1 WHERE id = ?`).run(best.id);
    }
  },

  recomputeAllBestDeals(): void {
    getDb().exec(BEST_DEAL_RECOMPUTE_ALL_SQL);
  },

  getPriceHistory(gameId: string, limit: number = 100): PriceHistoryEntry[] {
    const rows = prepareStmt(`
      SELECT ph.*, m.name as merchant_name, m.is_official
      FROM price_history ph
      JOIN merchants m ON ph.merchant_id = m.id
      WHERE ph.game_id = ?
      ORDER BY ph.recorded_at DESC
      LIMIT ?
    `).all(gameId, limit) as any[];

    return rows.map(r => ({
      id: r.id,
      gameId: r.game_id,
      merchantId: r.merchant_id,
      merchantName: r.merchant_name,
      isOfficial: Boolean(r.is_official),
      sourceCode: r.source_code as SourceCode,
      priceEur: Number(r.price_eur),
      discountPercent: r.discount_percent ? Number(r.discount_percent) : undefined,
      priceEvent: r.price_event || undefined,
      dealScore: r.deal_score !== null && r.deal_score !== undefined ? Number(r.deal_score) : undefined,
      recordedAt: r.recorded_at
    }));
  },

  getOffersCsvExportData(profileId: string): Array<{
    game_title: string;
    merchant_name: string;
    merchant_is_official: number;
    price_eur: number;
    msrp_eur: number | null;
    typical_sale_median_eur: number | null;
    atl_eur: number | null;
    atl_is_confirmed: number | null;
    risk_level: string | null;
    risk_score: number | null;
    risk_flags: string | null;
    is_anomaly: number;
    is_best_deal: number;
    last_observed_at: string | null;
  }> {
    return prepareStmt(`
      SELECT
        g.title AS game_title,
        m.name AS merchant_name,
        m.is_official AS merchant_is_official,
        o.price_eur,
        g.base_price_eur AS msrp_eur,
        g.typical_sale_median_eur,
        g.historical_low_eur AS atl_eur,
        g.atl_is_confirmed,
        o.risk_level,
        o.risk_score,
        o.risk_flags,
        o.is_anomaly,
        o.is_best_deal,
        o.last_observed_at
      FROM offers o
      JOIN games g ON o.game_id = g.id
      JOIN merchants m ON o.merchant_id = m.id
      JOIN wishlist_entries w ON w.game_id = g.id
      WHERE w.profile_id = ? AND w.is_active = 1 AND o.is_valid = 1
      ORDER BY g.title, o.price_eur ASC
    `).all(profileId) as any[];
  },

  getBatchOffers(steamAppIds: number[], options?: { onlyOfficial?: boolean; includeAllOffers?: boolean }): {
    results: Record<string, any>;
    fetchedAt: string;
  } {
    const fetchedAt = new Date().toISOString();
    const results: Record<string, any> = {};

    if (!steamAppIds || steamAppIds.length === 0) {
      return { results, fetchedAt };
    }

    for (const appId of steamAppIds) {
      const g = gameRepo.getBySteamAppId(appId);
      if (!g) continue;

      let offers = offerRepo.getOffersForGame(g.id);
      if (options?.onlyOfficial) {
        offers = offers.filter(o => o.isOfficial);
      }

      const bestDeal = offers.find(o => o.isBestDeal) || offers[0] || null;

      results[String(appId)] = {
        gameId: g.id,
        title: g.title,
        msrpEur: g.basePriceEur ?? null,
        historicalLowEur: g.historicalLowEur ?? null,
        historicalLowDate: g.historicalLowDate ?? null,
        bestPriceEur: bestDeal ? bestDeal.priceEur : (g.basePriceEur ?? null),
        bestMerchant: bestDeal ? bestDeal.merchantName : (g.bestMerchantName || null),
        isOfficial: bestDeal ? bestDeal.isOfficial : (g.bestMerchantIsOfficial ?? false),
        voucherCode: bestDeal?.voucherCode || null,
        dealUrl: bestDeal?.dealUrl || null,
        dealScore: bestDeal ? bestDeal.dealScore : g.bestDealScore,
        dealTier: bestDeal ? bestDeal.dealTier : g.bestDealTier,
        riskLevel: bestDeal ? bestDeal.riskLevel : (g.bestRiskLevel || 'SAFE'),
        riskFlags: bestDeal ? bestDeal.riskFlags : [],
        actionSignal: g.actionSignal || null,
        ...(options?.includeAllOffers ? { offers } : {})
      };
    }

    return { results, fetchedAt };
  }
};
