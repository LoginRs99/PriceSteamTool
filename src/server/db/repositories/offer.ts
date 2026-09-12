import { randomUUID } from 'crypto';
import { getDb, prepareStmt, BEST_DEAL_RECOMPUTE_ALL_SQL } from '../core.js';
import { gameRepo } from './game.js';
import { merchantRepo } from './merchant.js';
import { pricingErrorRepo } from './pricingError.js';
import { evaluatePriceMovement, type PriceEvaluationInput } from '../../domain/pricingError.js';
import { calculateDealScore } from '../../domain/dealScore.js';
import { calculateTypicalSalePrice, calculatePeriodLows } from '../../domain/priceIntelligence.js';
import { isKeyshopSourceStr, isOfficialStoreSource } from '../../domain/priceIntelligence/types.js';
import { FRESHNESS_WINDOW_MS, OFFER_MAX_AGE_DAYS } from '../../domain/constants.js';
import type { 
  Game, 
  Offer, 
  SourceCode, 
  PriceHistoryEntry 
} from '../../../shared/types.js';

const FRESHNESS_WINDOW_HOURS = Math.round(FRESHNESS_WINDOW_MS / (60 * 60 * 1000));

export function isCompatiblePeerOffer(
  target: { productType: string; regionType: string },
  peer: {
    productType: string;
    regionType: string;
    isValid?: boolean;
    isAnomaly?: boolean;
    isLikelyPricingError?: boolean;
    riskLevel?: string;
    lastObservedAt?: string;
    fetchedAt?: string;
  },
  options: {
    nowMs?: number;
    freshnessWindowMs?: number;
    allowAnomalies?: boolean;
    allowPricingErrors?: boolean;
  } = {}
): boolean {
  const nowMs = options.nowMs ?? Date.now();
  const freshnessWindowMs = options.freshnessWindowMs ?? FRESHNESS_WINDOW_MS;

  if (peer.isValid === false) return false;
  
  const disallowErrors = options.allowPricingErrors !== undefined ? !options.allowPricingErrors : !options.allowAnomalies;
  if (disallowErrors) {
    if (peer.isLikelyPricingError === true || peer.isAnomaly === true) return false;
    if (peer.riskLevel === 'HIGH') return false;
  }
  
  if (peer.productType !== target.productType) return false;

  // Stale peer check: observations older than 72 hours cannot participate in live market evaluation
  const ts = peer.lastObservedAt || peer.fetchedAt;
  if (ts) {
    const t = new Date(ts).getTime();
    if (!isNaN(t) && (nowMs - t) > freshnessWindowMs) {
      return false;
    }
  }

  // Explicit region compatibility hierarchy:
  // - GLOBAL key activates anywhere -> valid peer for GLOBAL, EU, and HU offers
  // - EU key activates within the EU (including Hungary) -> valid peer for EU and HU offers, but NOT GLOBAL
  // - HU key activates only in Hungary -> valid peer only for HU offers, NOT GLOBAL or EU
  if (peer.regionType === 'GLOBAL') {
    return target.regionType === 'GLOBAL' || target.regionType === 'EU' || target.regionType === 'HU';
  }
  if (peer.regionType === 'EU') {
    return target.regionType === 'EU' || target.regionType === 'HU';
  }
  if (peer.regionType === 'HU') {
    return target.regionType === 'HU';
  }

  return false;
}

function ensureAbsoluteUrl(url?: string): string {
  if (!url || typeof url !== 'string') return 'https://store.steampowered.com';
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

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
    sourceCode?: SourceCode;
    rawObservationJson?: string;
    editionName?: string;
  }): Offer {
    const db = getDb();
    const now = new Date().toISOString();
    const dealUrl = ensureAbsoluteUrl(data.dealUrl);
    const discount = (data as any).discountPercent !== undefined ? (data as any).discountPercent : 
      (data.originalPriceEur && data.originalPriceEur > data.priceEur 
        ? Math.round(((data.originalPriceEur - data.priceEur) / data.originalPriceEur) * 100) 
        : 0);

    const tx = db.transaction(() => {
      let offerId: string;
      const existing = prepareStmt(`
        SELECT id, price_eur FROM offers 
        WHERE game_id = ? AND merchant_id = ? AND product_type = ? AND region_type = ?
      `).get(data.gameId, data.merchantId, data.productType, data.regionType) as any;
      if (existing) {
        offerId = existing.id;
      } else {
        offerId = randomUUID();
        prepareStmt(`
          INSERT INTO offers (
            id, game_id, merchant_id, product_type, region_type, region_code, region_confidence,
            price_eur, original_price_eur, raw_price, raw_currency, raw_original_price,
            discount_percent, voucher_code, deal_url,
            is_best_deal, is_valid, price_event,
            is_likely_pricing_error, pricing_error_confidence, pricing_error_type, pricing_error_reason,
            fetched_at, last_observed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'NONE', 0, 0.0, NULL, NULL, ?, ?, ?, ?)
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
          dealUrl,
          data.isValid !== false ? 1 : 0,
          now,
          now,
          now,
          now
        );
      }

      // 1. Record / update individual source observation in source_observations
      const obsMeta = {
        dealUrl,
        voucherCode: data.voucherCode || null,
        originalPriceEur: data.originalPriceEur || null,
        rawPrice: data.rawPrice !== undefined ? data.rawPrice : null,
        rawCurrency: data.rawCurrency || 'EUR',
        rawOriginalPrice: data.rawOriginalPrice !== undefined ? data.rawOriginalPrice : null,
        discountPercent: discount,
        isValid: data.isValid !== false,
        editionName: data.editionName || null
      };

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
        JSON.stringify(obsMeta)
      );

      // 2. Query all active source observations for this canonical offer to determine the winner deterministically
      const allObservations = prepareStmt(`
        SELECT * FROM source_observations WHERE offer_id = ?
      `).all(offerId) as any[];

      interface CandidateObs {
        sourceCode: SourceCode;
        priceEur: number;
        rawPrice?: number;
        rawCurrency?: string;
        rawOriginalPrice?: number;
        originalPriceEur?: number;
        discountPercent: number;
        voucherCode?: string;
        dealUrl: string;
        isValid: boolean;
        observedAt: string;
        editionName?: string;
      }

      const candidates: CandidateObs[] = allObservations.map(obs => {
        let meta: any = {};
        try { meta = JSON.parse(obs.raw_data_json || '{}'); } catch {}
        return {
          sourceCode: obs.source_code as SourceCode,
          priceEur: Number(obs.observed_price_eur),
          rawPrice: obs.observed_raw_price !== null && obs.observed_raw_price !== undefined ? Number(obs.observed_raw_price) : undefined,
          rawCurrency: obs.observed_currency || 'EUR',
          rawOriginalPrice: meta.rawOriginalPrice !== null && meta.rawOriginalPrice !== undefined ? Number(meta.rawOriginalPrice) : undefined,
          originalPriceEur: meta.originalPriceEur !== null && meta.originalPriceEur !== undefined ? Number(meta.originalPriceEur) : undefined,
          discountPercent: meta.discountPercent !== undefined ? Number(meta.discountPercent) : 0,
          voucherCode: meta.voucherCode || undefined,
          dealUrl: ensureAbsoluteUrl(meta.dealUrl || dealUrl),
          isValid: meta.isValid !== false && !isNaN(Number(obs.observed_price_eur)) && Number(obs.observed_price_eur) >= 0,
          observedAt: obs.observed_at,
          editionName: meta.editionName || undefined
        };
      }).filter(c => c.isValid);

      // Deterministic active offer rule with freshness awareness:
      // 1. Fresh observations (within 72h) beat stale observations
      // 2. Lowest valid comparable price wins
      // 3. Fresher observation timestamp wins
      // 4. Alphabetical source_code tie-break
      const nowMs = new Date(now).getTime();

      const freshCandidates = candidates.filter(c => {
        const obsTime = new Date(c.observedAt).getTime();
        return !isNaN(obsTime) && (nowMs - obsTime) <= FRESHNESS_WINDOW_MS;
      });

      const eligiblePool = freshCandidates.length > 0 ? freshCandidates : candidates;
      const isStaleObservation = freshCandidates.length === 0 && candidates.length > 0;

      eligiblePool.sort((a, b) => {
        if (Math.abs(a.priceEur - b.priceEur) >= 0.005) {
          return a.priceEur - b.priceEur;
        }
        const timeA = new Date(a.observedAt).getTime();
        const timeB = new Date(b.observedAt).getTime();
        if (timeA !== timeB) {
          return timeB - timeA;
        }
        return a.sourceCode.localeCompare(b.sourceCode);
      });

      const active: CandidateObs = eligiblePool.length > 0 ? eligiblePool[0] : {
        sourceCode: data.sourceCode || 'steam',
        priceEur: data.priceEur,
        rawPrice: data.rawPrice,
        rawCurrency: data.rawCurrency || 'EUR',
        rawOriginalPrice: data.rawOriginalPrice,
        originalPriceEur: data.originalPriceEur,
        discountPercent: discount,
        voucherCode: data.voucherCode,
        dealUrl: dealUrl,
        isValid: data.isValid !== false,
        observedAt: now,
        editionName: data.editionName
      };

      // 3. Gather context for pricing evaluation using winning active offer values
      const gameInfo = prepareStmt(`SELECT * FROM games WHERE id = ?`).get(data.gameId) as any;
      const merchantInfo = prepareStmt(`SELECT name, is_official FROM merchants WHERE id = ?`).get(data.merchantId) as any;
      
      const otherOffersRows = prepareStmt(`
        SELECT o.price_eur, o.merchant_id, o.product_type, o.region_type, o.is_valid, o.is_likely_pricing_error, o.last_observed_at, o.fetched_at
        FROM offers o
        WHERE o.game_id = ? AND o.merchant_id != ?
      `).all(data.gameId, data.merchantId) as any[];

      // All valid active offers for this game participate in the real market price baseline
      const corroborationPeers = otherOffersRows.filter(row => Boolean(row.is_valid));
      const marketPrices = corroborationPeers
        .filter(row => Number(row.price_eur) > 0)
        .map(p => Number(p.price_eur));
      const distinctSources = new Set(allObservations.map(o => o.source_code));
      const distinctSourceCount = distinctSources.size;

      // Count distinct independent merchants with compatible prices (within 30% of active price)
      const corroboratingMerchants = new Set<string>();
      for (const peer of corroborationPeers) {
        const peerPrice = Number(peer.price_eur);
        if (peerPrice >= 0 && active.priceEur >= 0) {
          const minP = Math.min(peerPrice, active.priceEur);
          const relDiff = minP === 0 ? (peerPrice === active.priceEur ? 0 : 1) : Math.abs(peerPrice - active.priceEur) / minP;
          if (relDiff <= 0.30) {
            corroboratingMerchants.add(peer.merchant_id);
          }
        }
      }
      const corroboratingCount = corroboratingMerchants.size + 1; // +1 for current merchant
      const independentMerchantCount = corroboratingCount >= 2
        ? corroboratingCount
        : (merchantInfo?.is_official && distinctSourceCount >= 2 ? 2 : corroboratingCount);

      const sourceHistoryRows = prepareStmt(`
        SELECT price_eur, raw_price, raw_currency FROM price_history 
        WHERE game_id = ? AND merchant_id = ? AND source_code = ? AND is_pricing_error = 0
        ORDER BY recorded_at ASC
      `).all(data.gameId, data.merchantId, active.sourceCode) as any[];
      const sourceHistory = sourceHistoryRows.map(r => Number(r.price_eur));

      const lastMerchantHistory = prepareStmt(`
        SELECT price_eur, raw_price, raw_currency, discount_percent FROM price_history 
        WHERE game_id = ? AND merchant_id = ? AND is_pricing_error = 0
        ORDER BY recorded_at DESC LIMIT 1
      `).get(data.gameId, data.merchantId) as any;

      const lastHistory = prepareStmt(`
        SELECT price_eur, raw_price, raw_currency, discount_percent FROM price_history 
        WHERE game_id = ? AND merchant_id = ? AND source_code = ? AND is_pricing_error = 0
        ORDER BY recorded_at DESC LIMIT 1
      `).get(data.gameId, data.merchantId, active.sourceCode) as any;

      const PREMIUM_EDITION_RE = /(deluxe|ultimate|gold|premium|collector|goty|complete)/i;
      let suspectedEditionInversion = false;
      if (active.editionName && PREMIUM_EDITION_RE.test(active.editionName)) {
        const peerPrices = otherOffersRows
          .filter(p => Boolean(p.is_valid) && !p.is_likely_pricing_error)
          .map(p => Number(p.price_eur)).filter(p => p > 0);
        if (peerPrices.length > 0 && active.priceEur < Math.min(...peerPrices) * 0.90) {
          suspectedEditionInversion = true;
        }
      }

      const evalInput: PriceEvaluationInput = {
        currentPriceEur: active.priceEur,
        originalPriceEur: active.originalPriceEur,
        basePriceEur: gameInfo?.base_price_eur ? Number(gameInfo.base_price_eur) : undefined,
        historicalLowEur: gameInfo?.historical_low_eur ? Number(gameInfo.historical_low_eur) : undefined,
        previousPriceEur: lastHistory?.price_eur ? Number(lastHistory.price_eur) : undefined,
        marketPricesEur: marketPrices,
        sourceHistoryEur: sourceHistory,
        sourceAgreementCount: Math.max(1, distinctSourceCount),
        independentMerchantCount,
        isOfficialMerchant: merchantInfo ? Boolean(merchantInfo.is_official) : false,
        gameReleaseDate: gameInfo?.release_date || undefined,
        productType: data.productType,
        regionConfidence: data.regionConfidence,
        isStaleObservation,
        suspectedEditionInversion
      };

      const pricingEval = evaluatePriceMovement(evalInput);

      // 4. Update the canonical offers table with winning active observation
      prepareStmt(`
        UPDATE offers
        SET price_eur = ?,
            original_price_eur = ?,
            raw_price = ?,
            raw_currency = ?,
            raw_original_price = ?,
            discount_percent = ?,
            voucher_code = ?,
            deal_url = ?,
            is_valid = ?,
            price_event = ?,
            is_likely_pricing_error = ?,
            pricing_error_confidence = ?,
            pricing_error_type = ?,
            pricing_error_reason = ?,
            region_confidence = ?,
            last_observed_at = ?,
            fetched_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        active.priceEur,
        active.originalPriceEur || null,
        active.rawPrice !== undefined ? active.rawPrice : null,
        active.rawCurrency || null,
        active.rawOriginalPrice !== undefined ? active.rawOriginalPrice : null,
        active.discountPercent,
        active.voucherCode || null,
        active.dealUrl,
        active.isValid ? 1 : 0,
        pricingEval.event,
        pricingEval.isAnomaly ? 1 : 0,
        pricingEval.riskScore,
        (pricingEval.riskFlags && pricingEval.riskFlags[0]) || null,
        pricingEval.summary || null,
        data.regionConfidence !== undefined ? data.regionConfidence : 1.0,
        active.observedAt,
        now,
        now,
        offerId
      );

      // 5. FX-safe and ping-pong-safe price history tracking
      const isEquivalentHistory = (histRow: any, target: { priceEur: number; rawPrice?: number; rawCurrency?: string; discount: number }) => {
        if (!histRow) return false;
        // Native currency continuity: if both records share native currency and raw price is recorded
        if (
          histRow.raw_currency && 
          target.rawCurrency && 
          histRow.raw_currency.toUpperCase() === target.rawCurrency.toUpperCase() &&
          histRow.raw_price !== null && 
          histRow.raw_price !== undefined &&
          target.rawPrice !== undefined && 
          target.rawPrice !== null
        ) {
          return Math.abs(Number(histRow.raw_price) - target.rawPrice) < 0.005;
        }
        // EUR / standard comparison fallback
        const isEurSame = Math.abs(Number(histRow.price_eur) - target.priceEur) < 0.005;
        const isDiscountSame = Number(histRow.discount_percent || 0) === target.discount;
        return isEurSame && isDiscountSame;
      };

      const isSameAsLatestMerchant = isEquivalentHistory(lastMerchantHistory, {
        priceEur: active.priceEur,
        rawPrice: active.rawPrice,
        rawCurrency: active.rawCurrency,
        discount: active.discountPercent
      });

      const isSameAsLatestSource = isEquivalentHistory(lastHistory, {
        priceEur: active.priceEur,
        rawPrice: active.rawPrice,
        rawCurrency: active.rawCurrency,
        discount: active.discountPercent
      });

      const hasPriceChanged = !isSameAsLatestMerchant && !isSameAsLatestSource;

      // Update historical low only on genuine price drop
      if (hasPriceChanged && (pricingEval.event === 'RECORD_DROP' || pricingEval.event === 'NEW_HISTORICAL_LOW')) {
        gameRepo.updateHistoricalLow(data.gameId, active.priceEur, now, active.sourceCode);
      }

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
          rawPrice: h.raw_price !== null && h.raw_price !== undefined ? Number(h.raw_price) : undefined,
          rawCurrency: h.raw_currency || undefined,
          fxRate: h.fx_rate !== null && h.fx_rate !== undefined ? Number(h.fx_rate) : undefined,
          discountPercent: Number(h.discount_percent || 0),
          priceEvent: h.price_event || 'NONE',
          dealScore: h.deal_score ? Number(h.deal_score) : undefined,
          isPricingError: Boolean(h.is_pricing_error),
          recordedAt: h.recorded_at
        }));

        const currentObservation: PriceHistoryEntry = {
          id: 'temp',
          gameId: data.gameId,
          merchantId: data.merchantId,
          merchantName: merchantInfo?.name || '',
          isOfficial: Boolean(merchantInfo?.is_official),
          sourceCode: active.sourceCode,
          priceEur: active.priceEur,
          rawPrice: active.rawPrice,
          rawCurrency: active.rawCurrency,
          discountPercent: active.discountPercent,
          priceEvent: pricingEval.event,
          isPricingError: pricingEval.isAnomaly,
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
          atlIsConfirmed: gameInfo.atl_is_confirmed !== null && gameInfo.atl_is_confirmed !== undefined ? Boolean(gameInfo.atl_is_confirmed) : undefined,
          atlIsSingleSourceLow: gameInfo.atl_is_single_source_low !== null && gameInfo.atl_is_single_source_low !== undefined ? Boolean(gameInfo.atl_is_single_source_low) : undefined,
          isDlc: Boolean(gameInfo.is_dlc),
          isFree: Boolean(gameInfo.is_free),
          hasPricingError: false,
          offersCount: 1,
          createdAt: gameInfo.created_at,
          updatedAt: now
        };

        const periodLows = calculatePeriodLows(mappedGame, fullHistory, {
          id: offerId,
          gameId: data.gameId,
          merchantId: data.merchantId,
          merchantName: merchantInfo?.name || '',
          merchantCode: '',
          isOfficial: Boolean(merchantInfo?.is_official),
          productType: data.productType as any,
          regionType: data.regionType as any,
          regionConfidence: data.regionConfidence || 1.0,
          priceEur: active.priceEur,
          discountPercent: active.discountPercent,
          dealUrl: active.dealUrl,
          isBestDeal: false,
          isValid: active.isValid,
          priceEvent: pricingEval.event,
          isLikelyPricingError: pricingEval.isAnomaly,
          dealScore: 0,
          dealTier: 'Fair',
          sources: [active.sourceCode],
          sourceAgreementCount: distinctSourceCount,
          fetchedAt: now,
          lastObservedAt: active.observedAt || now,
          createdAt: now,
          updatedAt: now
        });

        // Derive firstObservedAt the same way the read path does:
        // price_tracking_first_observed_at = oldest recorded_at in price_history for this game
        // (rawHistory is ordered DESC so the last element is the oldest entry).
        const firstObservedAt = gameInfo?.price_tracking_first_observed_at || (rawHistory.length > 0
          ? rawHistory[rawHistory.length - 1].recorded_at
          : now);

        // Persist rolling stats
        const atlConfirmed = periodLows.allTimeLow.isConfirmed ? 1 : 0;
        const atlSingleSource = (periodLows.allTimeLow.isConfirmed === false || Boolean(periodLows.low90d.isSingleSourceLow)) ? 1 : 0;
        prepareStmt(`
          UPDATE games 
          SET typical_sale_median_eur = ?,
              typical_sale_q1_eur = ?,
              typical_sale_q3_eur = ?,
              typical_sale_sample_count = ?,
              typical_sale_low_confidence = ?,
              low_90d_eur = ?,
              low_1y_eur = ?,
              atl_is_confirmed = ?,
              atl_is_single_source_low = ?,
              price_tracking_first_observed_at = COALESCE(price_tracking_first_observed_at, ?),
              deal_score_stats_updated_at = ?,
              best_offer_source_count = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          typicalSale.medianPriceEur,
          typicalSale.q1PriceEur,
          typicalSale.q3PriceEur,
          typicalSale.sampleCount,
          typicalSale.isLowConfidence ? 1 : 0,
          periodLows.low90d.priceEur,
          periodLows.low1y.priceEur,
          atlConfirmed,
          atlSingleSource,
          firstObservedAt,
          now,
          Math.max(1, distinctSourceCount),
          now,
          data.gameId
        );

        const dealCalc = calculateDealScore({
          priceEur: active.priceEur,
          basePriceEur: basePrice,
          typicalSaleMedianEur: typicalSale.medianPriceEur,
          typicalSaleQ1Eur: typicalSale.q1PriceEur,
          typicalSaleQ3Eur: typicalSale.q3PriceEur,
          low90dEur: periodLows.low90d.priceEur,
          low1yEur: periodLows.low1y.priceEur,
          allTimeLowEur: periodLows.allTimeLow.priceEur || (gameInfo?.historical_low_eur ? Number(gameInfo.historical_low_eur) : undefined),
          historicalLowEur: periodLows.allTimeLow.priceEur || (gameInfo?.historical_low_eur ? Number(gameInfo.historical_low_eur) : undefined),
          isConfirmedAtl: periodLows.allTimeLow.isConfirmed,
          isSingleSourceLow: Boolean(periodLows.allTimeLow.isConfirmed === false || periodLows.low90d.isSingleSourceLow),
          isPricingError: pricingEval.isAnomaly,
          // Pass the same context fields the read paths use so write-time and read-time scores match
          sampleCount: typicalSale.sampleCount,
          sourceCount: Math.max(1, distinctSourceCount),

          lastObservedAt: active.observedAt || now,
          firstObservedAt
        });

        const fxRate = active.rawPrice && active.rawPrice > 0 
          ? Math.round((active.priceEur / active.rawPrice) * 10000) / 10000 
          : 1.0;

        prepareStmt(`
          INSERT INTO price_history (id, game_id, merchant_id, source_code, price_eur, raw_price, raw_currency, fx_rate, discount_percent, price_event, deal_score, is_pricing_error, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(), 
          data.gameId, 
          data.merchantId, 
          active.sourceCode, 
          active.priceEur, 
          active.rawPrice !== undefined ? active.rawPrice : null, 
          active.rawCurrency || 'EUR', 
          fxRate, 
          active.discountPercent, 
          pricingEval.event, 
          dealCalc.score, 
          pricingEval.isAnomaly ? 1 : 0, 
          now
        );
      }

      // Recalculate best deal for this game
      offerRepo.recomputeBestDealForGame(data.gameId);

      // Manage genuine pricing errors in the pricing_errors table (Data Safety audit trail)
      if (pricingEval.isAnomaly) {
        const errorType = (pricingEval.riskFlags && pricingEval.riskFlags[0])
          ? pricingEval.riskFlags[0]
          : 'PRICE_GLITCH';
        const previousPriceEur = existing?.price_eur !== null && existing?.price_eur !== undefined 
          ? Number(existing.price_eur) 
          : undefined;
        pricingErrorRepo.record(data.gameId, offerId, errorType, pricingEval.riskScore, pricingEval.summary, data.priceEur, previousPriceEur);
      } else {
        pricingErrorRepo.resolveForOffer(offerId);
      }

      return offerId;
    });

    const offerId = tx();
    return this.getById(offerId)!;
  },

  getById(id: string): Offer | null {
    const r = prepareStmt(`
      SELECT o.*, m.name as merchant_name, m.code as merchant_code, m.is_official,
             g.base_price_eur, g.historical_low_eur, g.typical_sale_median_eur, g.typical_sale_q1_eur,
             g.typical_sale_q3_eur, g.typical_sale_low_confidence, g.low_90d_eur, g.low_1y_eur,
             g.typical_sale_sample_count, g.price_tracking_first_observed_at, g.best_offer_source_count,
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
      : (r.historical_low_source ? isOfficialStoreSource(r.historical_low_source) : false);
    const isSingleSourceLow = r.atl_is_single_source_low !== null && r.atl_is_single_source_low !== undefined
      ? Boolean(r.atl_is_single_source_low)
      : (r.historical_low_source ? isKeyshopSourceStr(r.historical_low_source) : false);

    const dealCalc = calculateDealScore({
      priceEur: Number(r.price_eur),
      basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
      typicalSaleMedianEur: r.typical_sale_median_eur !== null && r.typical_sale_median_eur !== undefined ? Number(r.typical_sale_median_eur) : null,
      typicalSaleQ1Eur: r.typical_sale_q1_eur !== null && r.typical_sale_q1_eur !== undefined ? Number(r.typical_sale_q1_eur) : undefined,
      typicalSaleQ3Eur: r.typical_sale_q3_eur !== null && r.typical_sale_q3_eur !== undefined ? Number(r.typical_sale_q3_eur) : undefined,
      low90dEur: r.low_90d_eur !== null && r.low_90d_eur !== undefined ? Number(r.low_90d_eur) : null,
      low1yEur: r.low_1y_eur !== null && r.low_1y_eur !== undefined ? Number(r.low_1y_eur) : null,
      allTimeLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
      historicalLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
      isConfirmedAtl,
      isSingleSourceLow,
      sampleCount: r.typical_sale_sample_count !== null && r.typical_sale_sample_count !== undefined ? Number(r.typical_sale_sample_count) : undefined,
      firstObservedAt: r.price_tracking_first_observed_at || undefined,
      lastObservedAt: r.last_observed_at || r.fetched_at || undefined,
      sourceCount: sources.length > 0 ? sources.length : (r.best_offer_source_count ? Number(r.best_offer_source_count) : 1),
      isPricingError: Boolean(r.is_likely_pricing_error)
    });

    const obsTime = new Date(r.last_observed_at || r.fetched_at).getTime();
    const isFresh = !isNaN(obsTime) ? (Date.now() - obsTime) <= FRESHNESS_WINDOW_MS : false;

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
      isFresh,
      isValid: Boolean(r.is_valid),
      priceEvent: r.price_event || 'NONE',
      isLikelyPricingError: Boolean(r.is_likely_pricing_error),
      pricingErrorType: r.pricing_error_type || undefined,
      pricingErrorConfidence: r.pricing_error_confidence !== null && r.pricing_error_confidence !== undefined ? Number(r.pricing_error_confidence) : undefined,
      pricingErrorReason: r.pricing_error_reason || undefined,
      dealScore: dealCalc.score,
      dealTier: dealCalc.tier,
      verdict: dealCalc.verdict,
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
      SELECT o.*, m.name as merchant_name, m.code as merchant_code, m.is_official,
             g.base_price_eur, g.historical_low_eur, g.typical_sale_median_eur, g.typical_sale_q1_eur,
             g.typical_sale_q3_eur, g.typical_sale_low_confidence, g.low_90d_eur, g.low_1y_eur,
             g.typical_sale_sample_count, g.price_tracking_first_observed_at, g.best_offer_source_count,
             g.atl_is_confirmed, g.atl_is_single_source_low
      FROM offers o
      JOIN merchants m ON o.merchant_id = m.id
      LEFT JOIN games g ON o.game_id = g.id
      WHERE o.game_id = ?
      ORDER BY
        o.is_valid DESC,
        o.price_eur ASC,
        COALESCE(o.last_observed_at, o.fetched_at) DESC
    `).all(gameId) as any[];

    if (rows.length === 0) return [];

    const offerIds = rows.map(r => r.id).filter(Boolean);
    const sourcesByOffer = new Map<string, SourceCode[]>();

    if (offerIds.length > 0) {
      const placeholders = offerIds.map(() => '?').join(',');
      const obsRows = prepareStmt(`
        SELECT offer_id, source_code FROM source_observations WHERE offer_id IN (${placeholders})
      `).all(...offerIds) as { offer_id: string; source_code: string }[];

      for (const obs of obsRows) {
        const list = sourcesByOffer.get(obs.offer_id);
        if (list) {
          list.push(obs.source_code as SourceCode);
        } else {
          sourcesByOffer.set(obs.offer_id, [obs.source_code as SourceCode]);
        }
      }
    }

    return rows.map(r => {
      const sources = sourcesByOffer.get(r.id) || [];

      let riskFlags: any[] = [];
      if (r.risk_flags) {
        try { riskFlags = JSON.parse(r.risk_flags); } catch {}
      }

      const isOfficial = Boolean(r.is_official);
      const isConfirmedAtl = r.atl_is_confirmed !== null && r.atl_is_confirmed !== undefined
        ? Boolean(r.atl_is_confirmed)
        : (r.historical_low_source ? isOfficialStoreSource(r.historical_low_source) : false);
      const isSingleSourceLow = r.atl_is_single_source_low !== null && r.atl_is_single_source_low !== undefined
        ? Boolean(r.atl_is_single_source_low)
        : (r.historical_low_source ? isKeyshopSourceStr(r.historical_low_source) : false);

      const dealCalc = calculateDealScore({
        priceEur: Number(r.price_eur),
        basePriceEur: r.base_price_eur ? Number(r.base_price_eur) : undefined,
        typicalSaleMedianEur: r.typical_sale_median_eur !== null && r.typical_sale_median_eur !== undefined ? Number(r.typical_sale_median_eur) : null,
        typicalSaleQ1Eur: r.typical_sale_q1_eur !== null && r.typical_sale_q1_eur !== undefined ? Number(r.typical_sale_q1_eur) : undefined,
        typicalSaleQ3Eur: r.typical_sale_q3_eur !== null && r.typical_sale_q3_eur !== undefined ? Number(r.typical_sale_q3_eur) : undefined,
          low90dEur: r.low_90d_eur !== null && r.low_90d_eur !== undefined ? Number(r.low_90d_eur) : null,
        low1yEur: r.low_1y_eur !== null && r.low_1y_eur !== undefined ? Number(r.low_1y_eur) : null,
        allTimeLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
        historicalLowEur: r.historical_low_eur ? Number(r.historical_low_eur) : undefined,
        isConfirmedAtl,
        isSingleSourceLow,
        sampleCount: r.typical_sale_sample_count !== null && r.typical_sale_sample_count !== undefined ? Number(r.typical_sale_sample_count) : undefined,
        firstObservedAt: r.price_tracking_first_observed_at || undefined,
        lastObservedAt: r.last_observed_at || r.fetched_at || undefined,
        sourceCount: sources.length > 0 ? sources.length : (r.best_offer_source_count ? Number(r.best_offer_source_count) : 1),
        isPricingError: Boolean(r.is_likely_pricing_error)
      });

      const obsTime = new Date(r.last_observed_at || r.fetched_at).getTime();
      const isFresh = !isNaN(obsTime) ? (Date.now() - obsTime) <= FRESHNESS_WINDOW_MS : false;

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
        isFresh,
        isValid: Boolean(r.is_valid),
        priceEvent: r.price_event || 'NONE',
        isLikelyPricingError: Boolean(r.is_likely_pricing_error),
        pricingErrorType: r.pricing_error_type || undefined,
        pricingErrorConfidence: r.pricing_error_confidence !== null && r.pricing_error_confidence !== undefined ? Number(r.pricing_error_confidence) : undefined,
        pricingErrorReason: r.pricing_error_reason || undefined,
        dealScore: dealCalc.score,
        dealTier: dealCalc.tier,
        verdict: dealCalc.verdict,
        confidenceScore: dealCalc.confidenceScore,
        confidenceTier: dealCalc.confidenceTier,
        isProvisional: dealCalc.isProvisional,
        sources,
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
      WHERE game_id = ? AND is_valid = 1 AND is_likely_pricing_error = 0
      ORDER BY
        CASE
          WHEN (julianday('now') - julianday(COALESCE(last_observed_at, fetched_at))) * 24 <= ${FRESHNESS_WINDOW_HOURS} THEN 0
          ELSE 1
        END ASC,
        price_eur ASC,
        COALESCE(last_observed_at, fetched_at) DESC
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
      rawPrice: r.raw_price !== null && r.raw_price !== undefined ? Number(r.raw_price) : undefined,
      rawCurrency: r.raw_currency || undefined,
      fxRate: r.fx_rate !== null && r.fx_rate !== undefined ? Number(r.fx_rate) : undefined,
      discountPercent: r.discount_percent ? Number(r.discount_percent) : undefined,
      priceEvent: r.price_event || undefined,
      dealScore: r.deal_score !== null && r.deal_score !== undefined ? Number(r.deal_score) : undefined,
      isPricingError: Boolean(r.is_pricing_error),
      recordedAt: r.recorded_at
    }));
  },

  /**
   * One-time backfill / seed of past promotional price history points for a game
   */
  seedPriceHistoryForGame(
    gameId: string,
    historyPoints: Array<{
      shopName: string;
      priceEur: number;
      rawPrice?: number;
      rawCurrency?: string;
      regularPriceEur?: number;
      discountPercent?: number;
      timestamp: string;
    }>
  ): void {
    const db = getDb();
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      const gameRow = prepareStmt(`
        SELECT id, steam_app_id, title, slug, base_price_eur, historical_low_eur, 
               historical_low_date, historical_low_source, atl_is_confirmed, 
               atl_is_single_source_low, is_dlc, is_free, created_at, updated_at
        FROM games WHERE id = ?
      `).get(gameId) as any;

      if (!gameRow) return;

      const checkHistStmt = prepareStmt(`
        SELECT id FROM price_history 
        WHERE game_id = ? AND merchant_id = ? AND recorded_at = ? 
        LIMIT 1
      `);

      const insertHistStmt = prepareStmt(`
        INSERT INTO price_history (
          id, game_id, merchant_id, source_code, price_eur, raw_price, raw_currency,
          fx_rate, discount_percent, price_event, is_pricing_error, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1.0, ?, ?, 0, ?)
      `);

      if (Array.isArray(historyPoints) && historyPoints.length > 0) {
        for (const pt of historyPoints) {
          if (typeof pt.priceEur !== 'number' || isNaN(pt.priceEur) || pt.priceEur <= 0) continue;
          const shopName = pt.shopName || 'Store';
          const shopCode = shopName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'store';
          const merchant = merchantRepo.getOrCreate(shopCode, shopName, true);

          const existing = checkHistStmt.get(gameId, merchant.id, pt.timestamp);
          if (existing) continue;

          const disc = pt.discountPercent ? Math.round(pt.discountPercent) : 0;
          const priceEvent = disc >= 50 ? 'MAJOR_DROP' : (disc >= 15 ? 'STANDARD_SALE' : 'NONE');

          insertHistStmt.run(
            randomUUID(),
            gameId,
            merchant.id,
            'itad',
            pt.priceEur,
            pt.rawPrice !== undefined ? pt.rawPrice : null,
            pt.rawCurrency || 'EUR',
            disc,
            priceEvent,
            pt.timestamp
          );
        }
      }

      // Recompute stats using seeded history
      const rawHist = prepareStmt(`
        SELECT ph.*, m.name as merchant_name, m.code as merchant_code, m.is_official
        FROM price_history ph
        JOIN merchants m ON ph.merchant_id = m.id
        WHERE ph.game_id = ?
        ORDER BY ph.recorded_at DESC
      `).all(gameId) as any[];

      const history: PriceHistoryEntry[] = rawHist.map(h => ({
        id: h.id,
        gameId: h.game_id,
        merchantId: h.merchant_id,
        merchantName: h.merchant_name,
        merchantCode: h.merchant_code,
        isOfficial: Boolean(h.is_official),
        sourceCode: h.source_code as SourceCode,
        priceEur: Number(h.price_eur),
        rawPrice: h.raw_price !== null && h.raw_price !== undefined ? Number(h.raw_price) : undefined,
        rawCurrency: h.raw_currency || undefined,
        fxRate: h.fx_rate !== null && h.fx_rate !== undefined ? Number(h.fx_rate) : undefined,
        discountPercent: Number(h.discount_percent || 0),
        priceEvent: h.price_event || 'NONE',
        dealScore: h.deal_score ? Number(h.deal_score) : undefined,
        isPricingError: Boolean(h.is_pricing_error),
        recordedAt: h.recorded_at
      }));

      const basePrice = gameRow.base_price_eur ? Number(gameRow.base_price_eur) : undefined;
      const typicalSale = calculateTypicalSalePrice(basePrice, history);

      const mappedGame: Game = {
        id: gameRow.id,
        steamAppId: Number(gameRow.steam_app_id),
        title: gameRow.title,
        slug: gameRow.slug,
        basePriceEur: basePrice,
        historicalLowEur: gameRow.historical_low_eur ? Number(gameRow.historical_low_eur) : undefined,
        historicalLowDate: gameRow.historical_low_date || undefined,
        historicalLowSource: gameRow.historical_low_source || undefined,
        atlIsConfirmed: gameRow.atl_is_confirmed !== null && gameRow.atl_is_confirmed !== undefined ? Boolean(gameRow.atl_is_confirmed) : undefined,
        atlIsSingleSourceLow: gameRow.atl_is_single_source_low !== null && gameRow.atl_is_single_source_low !== undefined ? Boolean(gameRow.atl_is_single_source_low) : undefined,
        isDlc: Boolean(gameRow.is_dlc),
        isFree: Boolean(gameRow.is_free),
        hasPricingError: false,
        offersCount: 1,
        createdAt: gameRow.created_at,
        updatedAt: now
      };

      const currentBestOffer = offerRepo.getOffersForGame(gameId).find(o => o.isBestDeal);
      const periodLows = calculatePeriodLows(mappedGame, history, currentBestOffer);
      const atlConfirmed = periodLows.allTimeLow.isConfirmed ? 1 : 0;
      const atlSingleSource = (periodLows.allTimeLow.isConfirmed === false || Boolean(periodLows.low90d.isSingleSourceLow)) ? 1 : 0;

      // Check if seeded history reveals a lower all-time low
      let newHistLowEur = gameRow.historical_low_eur ? Number(gameRow.historical_low_eur) : undefined;
      let newHistLowDate = gameRow.historical_low_date || undefined;
      let newHistLowSource = gameRow.historical_low_source || undefined;

      for (const h of history) {
        if (h.isPricingError) continue;
        if (!newHistLowEur || h.priceEur < newHistLowEur) {
          newHistLowEur = h.priceEur;
          newHistLowDate = h.recordedAt;
          newHistLowSource = h.merchantName ? `ITAD (${h.merchantName})` : 'ITAD';
        }
      }

      const firstObservedAt = history.length > 0 
        ? history[history.length - 1].recordedAt 
        : now;

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
          historical_low_eur = ?,
          historical_low_date = ?,
          historical_low_source = ?,
          price_tracking_first_observed_at = COALESCE(price_tracking_first_observed_at, ?),
          deal_score_stats_updated_at = ?,
          price_history_seeded_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        typicalSale.medianPriceEur,
        typicalSale.q1PriceEur,
        typicalSale.q3PriceEur,
        typicalSale.sampleCount,
        typicalSale.isLowConfidence ? 1 : 0,
        periodLows.low90d.priceEur,
        periodLows.low1y.priceEur,
        atlConfirmed,
        atlSingleSource,
        newHistLowEur ?? null,
        newHistLowDate ?? null,
        newHistLowSource ?? null,
        firstObservedAt,
        now,
        now,
        now,
        gameId
      );
    });

    tx();
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
    is_likely_pricing_error: number;
    pricing_error_type: string | null;
    pricing_error_confidence: number | null;
    pricing_error_reason: string | null;
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
        CASE WHEN o.is_likely_pricing_error = 1 THEN 'HIGH' ELSE 'SAFE' END AS risk_level,
        o.pricing_error_confidence AS risk_score,
        o.pricing_error_type AS risk_flags,
        o.is_likely_pricing_error AS is_anomaly,
        o.is_likely_pricing_error,
        o.pricing_error_type,
        o.pricing_error_confidence,
        o.pricing_error_reason,
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
        actionSignal: g.actionSignal || null,
        ...(options?.includeAllOffers ? { offers } : {})
      };
    }

    return { results, fetchedAt };
  },

  /**
   * Invalidates offers that have not been observed in longer than maxAgeDays.
   * Prevents defunct/zombie offers from lingering forever as valid.
   */
  invalidateExpiredOffers(maxAgeDays: number = OFFER_MAX_AGE_DAYS): { invalidatedCount: number } {
    if (!maxAgeDays || maxAgeDays <= 0) return { invalidatedCount: 0 };
    const cutoffIso = new Date(Date.now() - maxAgeDays * 24 * 3600 * 1000).toISOString();
    const result = prepareStmt(`
      UPDATE offers 
      SET is_valid = 0, is_best_deal = 0, updated_at = datetime('now')
      WHERE is_valid = 1 AND COALESCE(last_observed_at, fetched_at) < ?
    `).run(cutoffIso);
    return { invalidatedCount: result.changes };
  },

  /**
   * Invalidates offers for a game that came exclusively from a given source (e.g. AllKeyShop)
   * and are no longer present in a fresh fetch result — e.g. after a manual mapping override,
   * so orphaned offers from the previous (incorrect) match don't linger as is_valid=1.
   * Offers observed by multiple sources (e.g. Steam + AllKeyShop) are preserved.
   */
  invalidateStaleForGameSource(gameId: string, sourceCode: string, keepOfferIds: string[]): { invalidatedCount: number } {
    if (!gameId || !sourceCode) return { invalidatedCount: 0 };
    const keepClause = keepOfferIds.length > 0
      ? `AND o.id NOT IN (${keepOfferIds.map(() => '?').join(',')})`
      : '';
    const result = prepareStmt(`
      UPDATE offers
      SET is_valid = 0, is_best_deal = 0, updated_at = datetime('now')
      WHERE id IN (
        SELECT o.id FROM offers o
        JOIN source_observations so ON so.offer_id = o.id AND so.source_code = ?
        WHERE o.game_id = ? AND o.is_valid = 1
        AND NOT EXISTS (
          SELECT 1 FROM source_observations other_so 
          WHERE other_so.offer_id = o.id AND other_so.source_code != ?
        )
        ${keepClause}
      )
    `).run(sourceCode, gameId, sourceCode, ...keepOfferIds);
    return { invalidatedCount: result.changes };
  },

  /**
   * Purges price_history rows older than retentionDays.
   * Does not touch games.historical_low_eur (all-time low) — that lives
   * separately and is unaffected by this cleanup.
   */
  purgeOldPriceHistory(retentionDays: number): { deletedCount: number } {
    if (!retentionDays || retentionDays <= 0) return { deletedCount: 0 };
    const cutoffIso = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString();
    const result = prepareStmt(`DELETE FROM price_history WHERE recorded_at < ?`).run(cutoffIso);
    return { deletedCount: result.changes };
  }
};
