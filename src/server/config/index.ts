import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'pricetool.db'),
  isDev: process.env.NODE_ENV !== 'production',
  
  // API Keys
  steamApiKey: process.env.STEAM_API_KEY || '',
  itadApiKey: process.env.ITAD_API_KEY || '',
  ggdealsApiKey: process.env.GGDEALS_API_KEY || '',
  
  // Source Pacing Defaults (ms) - Optimized for batch APIs & respectful scraping
  delays: {
    steam: parseInt(process.env.STEAM_DELAY_MS || '1500', 10),
    itad: parseInt(process.env.ITAD_DELAY_MS || '500', 10),
    ggdeals: parseInt(process.env.GGDEALS_DELAY_MS || '1000', 10),
    cheapshark: parseInt(process.env.CHEAPSHARK_DELAY_MS || '500', 10),
    allkeyshop: parseInt(process.env.ALLKEYSHOP_DELAY_MS || '7000', 10)
  },

  // Stealth & Anti-Ban Batching for Keyshop scrapers
  allkeyshopJitterMs: parseInt(process.env.ALLKEYSHOP_JITTER_MS || '4000', 10),
  allkeyshopChunkSize: parseInt(process.env.ALLKEYSHOP_CHUNK_SIZE || '30', 10),
  allkeyshopChunkPauseMs: parseInt(process.env.ALLKEYSHOP_CHUNK_PAUSE_MS || '100000', 10),

  // Cache & Periodic Auto-Sync settings
  cacheTtlHours: parseInt(process.env.CACHE_TTL_HOURS || '6', 10),
  historyRetentionDays: parseInt(process.env.HISTORY_RETENTION_DAYS || '365', 10),
  autoSyncEnabled: process.env.AUTO_SYNC_ENABLED !== 'false',
  autoSyncIntervalHours: parseInt(process.env.AUTO_SYNC_INTERVAL_HOURS || '6', 10),
  allkeyshopMaxGames: parseInt(process.env.ALLKEYSHOP_MAX_GAMES || '0', 10), // 0 = unlimited / all games

  // Region preferences (default: Hungary / EU / Global)
  preferredCountry: 'HU',
  preferredCurrency: 'EUR',
};
