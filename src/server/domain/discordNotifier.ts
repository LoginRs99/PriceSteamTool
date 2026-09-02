import { settingsRepo, notificationsRepo, offerRepo } from '../db/index.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';
import type { Game } from '../../shared/types.js';

export interface DiscordSettings {
  webhookUrl: string;
  hasWebhook?: boolean;
  webhookUrlMasked?: string;
  isEnabled: boolean;
  minDealScore: number;
  minConfidence: number;
  notifyAtlOnly: boolean;
  notifyFreeGames: boolean;
  cooldownHours: number;
}

export function maskWebhookUrl(url?: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.length <= 6) return '...';
  return '...' + trimmed.slice(-6);
}

export function getDiscordSettings(maskUrl = false): DiscordSettings {
  const urlFromDb = settingsRepo.get('discord_webhook_url');
  const rawWebhookUrl = urlFromDb !== undefined ? urlFromDb : (process.env.DISCORD_WEBHOOK_URL || '');
  const hasWebhook = Boolean(rawWebhookUrl);
  const webhookUrlMasked = maskWebhookUrl(rawWebhookUrl);
  const webhookUrl = maskUrl ? webhookUrlMasked : rawWebhookUrl;
  
  const enabledFromDb = settingsRepo.get('discord_enabled');
  const isEnabled = enabledFromDb !== undefined 
    ? enabledFromDb === 'true' 
    : (process.env.DISCORD_ENABLED ? process.env.DISCORD_ENABLED === 'true' : hasWebhook);

  const minScoreFromDb = settingsRepo.get('discord_min_deal_score');
  const minDealScore = minScoreFromDb !== undefined 
    ? parseInt(minScoreFromDb, 10) 
    : parseInt(process.env.DISCORD_MIN_DEAL_SCORE || '75', 10);

  const minConfFromDb = settingsRepo.get('discord_min_confidence');
  const minConfidence = minConfFromDb !== undefined 
    ? parseInt(minConfFromDb, 10) 
    : parseInt(process.env.DISCORD_MIN_CONFIDENCE || '40', 10);

  const atlOnlyFromDb = settingsRepo.get('discord_notify_atl_only');
  const notifyAtlOnly = atlOnlyFromDb !== undefined 
    ? atlOnlyFromDb === 'true' 
    : (process.env.DISCORD_NOTIFY_ATL_ONLY === 'true');

  const freeFromDb = settingsRepo.get('discord_notify_free_games');
  const notifyFreeGames = freeFromDb !== undefined 
    ? freeFromDb === 'true' 
    : (process.env.DISCORD_NOTIFY_FREE_GAMES !== 'false');

  const cooldownFromDb = settingsRepo.get('discord_cooldown_hours');
  const cooldownHours = cooldownFromDb !== undefined 
    ? parseInt(cooldownFromDb, 10) 
    : parseInt(process.env.DISCORD_COOLDOWN_HOURS || '24', 10);

  return {
    webhookUrl,
    hasWebhook,
    webhookUrlMasked,
    isEnabled,
    minDealScore: isNaN(minDealScore) ? 75 : Math.max(0, Math.min(100, minDealScore)),
    minConfidence: isNaN(minConfidence) ? 40 : Math.max(0, Math.min(100, minConfidence)),
    notifyAtlOnly,
    notifyFreeGames,
    cooldownHours: isNaN(cooldownHours) ? 24 : Math.max(1, cooldownHours)
  };
}

export function saveDiscordSettings(settings: Partial<DiscordSettings>): DiscordSettings {
  if (settings.webhookUrl !== undefined) {
    const trimmed = settings.webhookUrl.trim();
    // Do not overwrite existing real webhook URL if client sent back masked string (...xxxxxx)
    if (!trimmed.startsWith('...')) {
      settingsRepo.set('discord_webhook_url', trimmed);
    }
  }
  if (settings.isEnabled !== undefined) {
    settingsRepo.set('discord_enabled', settings.isEnabled ? 'true' : 'false');
  }
  if (settings.minDealScore !== undefined) {
    settingsRepo.set('discord_min_deal_score', String(settings.minDealScore));
  }
  if (settings.minConfidence !== undefined) {
    settingsRepo.set('discord_min_confidence', String(settings.minConfidence));
  }
  if (settings.notifyAtlOnly !== undefined) {
    settingsRepo.set('discord_notify_atl_only', settings.notifyAtlOnly ? 'true' : 'false');
  }
  if (settings.notifyFreeGames !== undefined) {
    settingsRepo.set('discord_notify_free_games', settings.notifyFreeGames ? 'true' : 'false');
  }
  if (settings.cooldownHours !== undefined) {
    settingsRepo.set('discord_cooldown_hours', String(settings.cooldownHours));
  }

  return getDiscordSettings();
}

export function isValidDiscordWebhookUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    const isDiscordHost = hostname === 'discord.com' ||
      hostname === 'discordapp.com' ||
      hostname === 'ptb.discord.com' ||
      hostname === 'canary.discord.com';
    return isDiscordHost && parsed.pathname.startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}

/**
 * Sends a test notification to verify the Discord Webhook connection
 */
export async function sendTestNotification(webhookUrlOverride?: string): Promise<{ success: boolean; error?: string }> {
  const settings = getDiscordSettings();
  const targetUrl = webhookUrlOverride ? webhookUrlOverride.trim() : settings.webhookUrl;

  if (!targetUrl || !isValidDiscordWebhookUrl(targetUrl)) {
    return { success: false, error: 'Invalid Discord Webhook URL. URL must start with https://discord.com/api/webhooks/' };
  }

  const payload = {
    username: 'PriceSteamTool',
    avatar_url: 'https://raw.githubusercontent.com/LoginRs99/PriceSteamTool/main/src/client/public/favicon.svg',
    embeds: [
      {
        title: '🎮 PriceSteamTool — Webhook Connected Successfully!',
        description: 'Your Discord webhook notification integration is active and ready to deliver real-time deal alerts from your Steam Wishlist.',
        color: 0x5865F2, // Discord Blurple
        fields: [
          {
            name: '🎯 Min Deal Score Alert Threshold',
            value: `**${settings.minDealScore} / 100** (${settings.minDealScore >= 85 ? 'Exceptional only' : settings.minDealScore >= 70 ? 'Great & Exceptional' : 'Fair+'})`,
            inline: true
          },
          {
            name: '🏆 All-Time Low Filter',
            value: settings.notifyAtlOnly ? '✅ Only ATL Deals' : '⚡ All Qualifying Drops',
            inline: true
          },
          {
            name: '🎁 100% Free Game Alerts',
            value: settings.notifyFreeGames ? '✅ Enabled' : '❌ Disabled',
            inline: true
          },
          {
            name: '⏱️ Anti-Spam Cooldown',
            value: `**${settings.cooldownHours} hours** per game`,
            inline: true
          },
          {
            name: '🚀 Status',
            value: settings.isEnabled ? '🟢 Active & Monitoring' : '🟡 Configured (Notifications Disabled in Settings)',
            inline: true
          }
        ],
        footer: {
          text: 'PriceSteamTool • Deal Notification Engine'
        },
        timestamp: new Date().toISOString()
      }
    ]
  };

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Discord API returned status ${res.status}: ${errText}` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: `Failed to connect to Discord webhook: ${err.message}` };
  }
}

/**
 * Dispatches rich deal alerts to Discord based on score thresholds and cooldown rules
 */
export async function sendDealNotifications(deals: Game[], trigger: string = 'MANUAL'): Promise<{ sentCount: number }> {
  const settings = getDiscordSettings();

  if (!settings.isEnabled || !settings.webhookUrl || !isValidDiscordWebhookUrl(settings.webhookUrl)) {
    return { sentCount: 0 };
  }

  let sentCount = 0;
  const MAX_ALERTS_PER_SYNC = 20; // Safety cap to prevent channel spamming during massive drops

  for (const game of deals) {
    if (sentCount >= MAX_ALERTS_PER_SYNC) {
      logWarn(`[Discord] Alert safety cap reached (${MAX_ALERTS_PER_SYNC} deals). Suppressing remaining alerts for this sync pass.`);
      break;
    }

    const isFree = game.isFree || game.bestPriceEur === 0;
    const dealScore = game.bestDealScore ?? 0;
    const bestPrice = game.bestPriceEur;

    if (bestPrice === undefined || bestPrice === null) continue;

    // 0. Stale Observation Guard (Never trigger Discord push alerts for stale data)
    if (game.bestIsFresh === false) {
      continue;
    }

    // 0.1 High Risk & Anomaly Exclusion Guard
    if (game.hasAnomaly || game.bestRiskLevel === 'HIGH') {
      continue;
    }

    // 1. Target Price Hit Check
    const hasTargetHit = game.targetPriceEur !== undefined && game.targetPriceEur !== null
      && bestPrice <= game.targetPriceEur + 0.05;

    // 2. Free Game Promotion Check
    let isQualifyingFreeGame = false;
    if (isFree && settings.notifyFreeGames && bestPrice === 0) {
      isQualifyingFreeGame = true;
    }

    // 3. Deal Score, Confidence & ATL Filter Check
    const confScore = game.bestConfidenceScore ?? 50;
    let isQualifyingDeal = false;

    if (hasTargetHit) {
      isQualifyingDeal = true;
    } else if (!isFree && dealScore >= settings.minDealScore && confScore >= settings.minConfidence) {
      if (settings.notifyAtlOnly) {
        // Provisional deals cannot claim verified ATL status
        if (!game.bestIsProvisional) {
          const isAtl = game.bestPriceEvent === 'NEW_HISTORICAL_LOW' || 
                        game.bestPriceEvent === 'AT_HISTORICAL_LOW' || 
                        (game.historicalLowEur && bestPrice <= game.historicalLowEur + 0.05);
          if (isAtl) {
            isQualifyingDeal = true;
          }
        }
      } else {
        isQualifyingDeal = true;
      }
    }

    if (!isQualifyingFreeGame && !isQualifyingDeal) {
      continue;
    }

    // 4. Cooldown & Deduplication Check
    if (notificationsRepo.hasRecentNotification(game.id, settings.cooldownHours, bestPrice)) {
      continue;
    }

    // 5. Fetch Best Offer details (for voucher code, merchant, etc.)
    const offers = offerRepo.getOffersForGame(game.id);
    const bestOffer = offers.find(o => o.isBestDeal && o.isValid) || offers[0];

    // 6. Construct Rich Embed
    const steamUrl = `https://store.steampowered.com/app/${game.steamAppId}`;
    const dealUrl = bestOffer?.dealUrl || game.bestDealUrl || steamUrl;
    const merchantName = bestOffer?.merchantName || game.bestMerchantName || 'Steam Store';
    const isOfficial = bestOffer?.isOfficial ?? game.bestMerchantIsOfficial ?? true;
    const discountPct = game.bestDiscountPercent || bestOffer?.discountPercent || 0;
    const basePrice = game.basePriceEur || (discountPct > 0 ? (bestPrice / (1 - discountPct / 100)) : undefined);

    let embedColor = 0x3498DB; // Default Blue
    let headline = '🏷️ **New Sale Price on Your Wishlist**';

    if (hasTargetHit) {
      embedColor = 0x00BFFF; // Deep Sky Blue / Target Cyan
      headline = `🎯 **Target Price Reached! (Target: €${game.targetPriceEur!.toFixed(2)})**`;
    } else if (isQualifyingFreeGame) {
      embedColor = 0x9B59B6; // Purple
      headline = '🎁 **100% Free Game Promotion!**';
    } else if (game.bestIsProvisional) {
      embedColor = 0xF1C40F; // Gold/Yellow
      headline = '⚡ **Provisional Deal Alert (Limited History)**';
    } else if (dealScore >= 85) {
      embedColor = 0xFF4500; // Flame Orange
      headline = '🔥 **Exceptional Deal Detected!**';
    } else if (dealScore >= 70) {
      embedColor = 0x2ECC71; // Emerald Green
      headline = '⭐ **Great Deal Detected!**';
    }

    const fields: Array<{ name: string; value: string; inline: boolean }> = [];

    if (isQualifyingFreeGame) {
      fields.push({
        name: '💰 Price',
        value: `**FREE (100% off)** ${basePrice ? `~~€${basePrice.toFixed(2)}~~` : ''}`,
        inline: true
      });
    } else {
      fields.push({
        name: '💰 Price',
        value: `**€${bestPrice.toFixed(2)}** ${basePrice ? `~~€${basePrice.toFixed(2)}~~` : ''} ${discountPct > 0 ? `(-${discountPct}%)` : ''}`,
        inline: true
      });
      
      const confLabel = game.bestConfidenceTier ? `${game.bestConfidenceTier} Conf` : `${confScore}% Conf`;
      const provTag = game.bestIsProvisional ? ' *(Provisional)*' : '';
      fields.push({
        name: '🏆 Deal Score',
        value: `**${dealScore} / 100** • ${game.bestDealTier || 'Good'}${provTag}\n*(${confScore}% ${confLabel})*`,
        inline: true
      });
    }

    if (hasTargetHit) {
      fields.push({
        name: '🎯 Target Price Alert',
        value: `Target: **€${game.targetPriceEur!.toFixed(2)}** • Hit: **€${bestPrice.toFixed(2)}**`,
        inline: true
      });
    }

    fields.push({
      name: '🏪 Store',
      value: `[${merchantName}](${dealUrl}) ${isOfficial ? '*(Official)*' : '*(Keyshop)*'}`,
      inline: true
    });

    if (bestOffer?.voucherCode) {
      fields.push({
        name: '🎟️ Voucher Code',
        value: `\`${bestOffer.voucherCode}\``,
        inline: true
      });
    }

    if (game.bestSavingVsMedianEur && game.bestSavingVsMedianEur > 0 && game.typicalSaleMedianEur) {
      fields.push({
        name: '📊 Typical Sale Comparison',
        value: `**€${game.bestSavingVsMedianEur.toFixed(2)} cheaper** than median sale (€${game.typicalSaleMedianEur.toFixed(2)})`,
        inline: true
      });
    }

    if (game.historicalLowEur && !game.bestIsProvisional) {
      const isNewAtl = bestPrice <= game.historicalLowEur + 0.05;
      fields.push({
        name: '📉 All-Time Low',
        value: isNewAtl ? `**€${bestPrice.toFixed(2)} (New ATL!)**` : `€${game.historicalLowEur.toFixed(2)}`,
        inline: true
      });
    }

    fields.push({
      name: '🎮 Store Links',
      value: `[Buy on ${merchantName}](${dealUrl}) • [Steam Storefront](${steamUrl})`,
      inline: false
    });

    const embed = {
      title: game.title,
      url: dealUrl,
      description: headline,
      color: embedColor,
      thumbnail: game.headerImage || game.capsuleImage ? {
        url: game.headerImage || game.capsuleImage
      } : undefined,
      fields,
      footer: {
        text: `PriceSteamTool • Wishlist Alert • ${trigger} sync`
      },
      timestamp: new Date().toISOString()
    };

    try {
      const res = await fetch(settings.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'PriceSteamTool',
          avatar_url: 'https://raw.githubusercontent.com/LoginRs99/PriceSteamTool/main/src/client/public/favicon.svg',
          embeds: [embed]
        }),
        signal: AbortSignal.timeout(8000)
      });

      if (res.ok) {
        notificationsRepo.logNotification(game.id, bestPrice, dealScore, 'discord');
        sentCount++;
        logInfo(`[Discord] Alert sent for "${game.title}" (€${bestPrice.toFixed(2)}, Score: ${dealScore})`);
      } else if (res.status === 429) {
        let retryAfterMs = 2000;
        try {
          const body: any = await res.json();
          if (body?.retry_after) retryAfterMs = Math.ceil(Number(body.retry_after) * 1000) + 100;
        } catch {}
        logWarn(`[Discord] Hit rate limit 429. Backing off for ${retryAfterMs}ms`);
        await new Promise(r => setTimeout(r, retryAfterMs));
      } else {
        const errBody = await res.text();
        logWarn(`[Discord] Failed to send alert for "${game.title}": ${res.status} ${errBody}`);
      }

      // Respect Discord Webhook rate limit (max 5 requests per 2 seconds = 400ms pace)
      if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
        await new Promise(r => setTimeout(r, 450));
      }
    } catch (e: any) {
      logError(`[Discord] Error sending alert for "${game.title}": ${e.message}`);
    }
  }

  if (sentCount > 0) {
    logInfo(`[Discord] Dispatched ${sentCount} deal notification(s) to Discord webhook.`);
  }

  return { sentCount };
}
