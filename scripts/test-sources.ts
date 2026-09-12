import { config } from '../src/server/config/index.js';
import { steamAdapter } from '../src/server/sources/steam.js';
import { itadAdapter } from '../src/server/sources/itad.js';
import { cheapsharkAdapter } from '../src/server/sources/cheapshark.js';
import { ggdealsAdapter } from '../src/server/sources/ggdeals.js';
import { allkeyshopAdapter } from '../src/server/sources/allkeyshop.js';

import { circuitBreakers } from '../src/server/sync/circuitBreaker.js';

// Default to Cyberpunk 2077 (1091500) or take from CLI args
const testAppId = process.argv[2] ? parseInt(process.argv[2], 10) : 1091500;
const testTitle = process.argv[3] || 'Cyberpunk 2077';

function maskKey(key?: string): string {
  if (!key) return '(not set - using public/fallback mode)';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

async function runLiveSourceDiagnostics() {
  circuitBreakers.recordSuccess('allkeyshop');
  console.log('======================================================');
  console.log('🔍 PRICETOOL - LIVE API & SOURCE ADAPTER DIAGNOSTICS');
  console.log('======================================================');
  console.log(`Target Test Game: "${testTitle}" (Steam AppID: ${testAppId})`);
  console.log('Configured API Credentials:');
  console.log(` - STEAM_API_KEY:    ${maskKey(config.steamApiKey)}`);
  console.log(` - ITAD_API_KEY:     ${maskKey(config.itadApiKey)}`);
  console.log(` - GGDEALS_API_KEY:  ${maskKey(config.ggdealsApiKey)}`);
  console.log(` - BYPARR / SOLVER:  ${config.allkeyshopSolverUrl || '(not set - using direct fetch)'}`);
  console.log(` - Preferred Country: ${config.preferredCountry}`);
  console.log('======================================================\n');

  // 1. Steam Storefront
  console.log('--- [1/7] Testing Steam Storefront Adapter ---');
  try {
    const steamDetails = await steamAdapter.fetchAppDetails(testAppId);
    if (steamDetails) {
      console.log(`✅ Steam Store responded:`);
      console.log(`   Title:         ${steamDetails.title}`);
      console.log(`   Base Price:    ${steamDetails.basePriceEur !== undefined ? `€${steamDetails.basePriceEur.toFixed(2)}` : 'N/A'}`);
      console.log(`   Current Price: ${steamDetails.currentPriceEur !== undefined ? `€${steamDetails.currentPriceEur.toFixed(2)}` : 'N/A'}`);
      console.log(`   Discount:      ${steamDetails.discountPercent}%`);
      console.log(`   Header Image:  ${steamDetails.headerImage}`);
    } else {
      console.log(`⚠️ Steam Store returned null for AppID ${testAppId}`);
    }
  } catch (err: any) {
    console.log(`❌ Steam Store error: ${err.message}`);
  }

  // 2. Steam Wishlist Ingestion (Testing IWishlistService fallback)
  console.log('\n--- [2/7] Testing Steam Wishlist Ingestion & Fallback ---');
  try {
    const testSteamId = process.env.TEST_STEAM_ID || '76561198033127514';
    const wishlistItems = await steamAdapter.fetchWishlist(testSteamId);
    console.log(`✅ Steam Wishlist responded:`);
    console.log(`   Items Returned: ${wishlistItems.length}`);
    if (wishlistItems.length > 0) {
      console.log(`   Sample Item:   AppID ${wishlistItems[0].steamAppId} ("${wishlistItems[0].title}")`);
    }
  } catch (err: any) {
    console.log(`❌ Steam Wishlist error: ${err.message}`);
  }

  // 3. Live Exchange Rates
  console.log('\n--- [3/7] Testing Exchange Rate Service ---');
  try {
    const { exchangeRateService } = await import('../src/server/domain/exchangeRate.js');
    await exchangeRateService.refreshRates();
    const usdRate = exchangeRateService.getRateToEur('USD');
    const gbpRate = exchangeRateService.getRateToEur('GBP');
    const hufRate = exchangeRateService.getRateToEur('HUF');
    console.log(`✅ Live Exchange Rates active:`);
    console.log(`   1 USD = €${usdRate.toFixed(4)} | 1 GBP = €${gbpRate.toFixed(4)} | 1000 HUF = €${(hufRate * 1000).toFixed(2)}`);
  } catch (err: any) {
    console.log(`❌ Exchange Rate error: ${err.message}`);
  }

  // 4. CheapShark (Public API)
  console.log('\n--- [4/7] Testing CheapShark Adapter (100% Public) ---');
  try {
    const cheapSharkOffers = await cheapsharkAdapter.fetchPricesForGame(testAppId, testTitle);
    console.log(`✅ CheapShark returned ${cheapSharkOffers.length} deals:`);
    for (const off of cheapSharkOffers.slice(0, 5)) {
      console.log(`   - ${off.merchantName.padEnd(20)} €${off.priceEur.toFixed(2)} (${off.dealUrl})`);
    }
    if (cheapSharkOffers.length > 5) {
      console.log(`   ... and ${cheapSharkOffers.length - 5} more store deals.`);
    }
  } catch (err: any) {
    console.log(`❌ CheapShark error: ${err.message}`);
  }

  // 5. IsThereAnyDeal
  console.log('\n--- [5/7] Testing IsThereAnyDeal Adapter ---');
  if (!config.itadApiKey) {
    console.log('ℹ️ ITAD_API_KEY is not set in .env. Skipping ITAD live call.');
  } else {
    try {
      const itadId = await itadAdapter.lookupItadId(testAppId);
      console.log(`   ITAD Game UUID: ${itadId || 'Not found'}`);
      if (itadId) {
        const itadOffers = await itadAdapter.fetchPricesForGame(testAppId, testTitle, itadId);
        console.log(`✅ ITAD returned ${itadOffers.length} offers:`);
        for (const off of itadOffers) {
          console.log(`   - ${off.merchantName.padEnd(20)} Current: €${off.priceEur.toFixed(2)}${off.historicalLowEur ? ` (All-time low: €${off.historicalLowEur.toFixed(2)})` : ''}`);
        }
      }
    } catch (err: any) {
      console.log(`❌ ITAD error: ${err.message}`);
    }
  }

  // 6. GG.deals
  console.log('\n--- [6/7] Testing GG.deals Adapter ---');
  try {
    const ggOffers = await ggdealsAdapter.fetchPricesForGame(testAppId, testTitle);
    console.log(`ℹ️ GG.deals returned ${ggOffers.length} deals:`);
    for (const off of ggOffers.slice(0, 5)) {
      console.log(`   - ${off.merchantName.padEnd(20)} €${off.priceEur.toFixed(2)} [${off.isOfficial ? 'Official' : 'Keyshop'}]`);
    }
  } catch (err: any) {
    console.log(`ℹ️ GG.deals: ${err.message}`);
  }

  // 7. AllKeyShop
  console.log('\n--- [7/7] Testing AllKeyShop Adapter ---');
  try {
    const aksOffers = await allkeyshopAdapter.fetchPricesForGame(testAppId, testTitle);
    console.log(`ℹ️ AllKeyShop returned ${aksOffers.length} deals:`);
    for (const off of aksOffers) {
      console.log(`   - ${off.merchantName} €${off.priceEur.toFixed(2)}`);
    }
  } catch (err: any) {
    console.log(`ℹ️ AllKeyShop note: ${err.message}`);
  }

  console.log('\n======================================================');
  console.log('🏁 DIAGNOSTICS COMPLETED');
  console.log('======================================================');
}

runLiveSourceDiagnostics().catch(err => {
  console.error('Diagnostic run failed:', err);
});
