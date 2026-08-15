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
  
  // Source Pacing Defaults (ms) - All at least 2000ms for safe, respectful execution
  delays: {
    steam: parseInt(process.env.STEAM_DELAY_MS || '2000', 10),
    itad: parseInt(process.env.ITAD_DELAY_MS || '2000', 10),
    ggdeals: parseInt(process.env.GGDEALS_DELAY_MS || '2500', 10),
    cheapshark: parseInt(process.env.CHEAPSHARK_DELAY_MS || '2000', 10),
    allkeyshop: parseInt(process.env.ALLKEYSHOP_DELAY_MS || '4000', 10),
    gocdkeys: parseInt(process.env.GOCDKEYS_DELAY_MS || '5000', 10),
  },

  // Cache & Periodic Auto-Sync settings
  cacheTtlHours: parseInt(process.env.CACHE_TTL_HOURS || '6', 10),
  historyRetentionDays: parseInt(process.env.HISTORY_RETENTION_DAYS || '365', 10),
  autoSyncEnabled: process.env.AUTO_SYNC_ENABLED !== 'false',
  autoSyncIntervalHours: parseInt(process.env.AUTO_SYNC_INTERVAL_HOURS || '6', 10),

  // Region preferences (default: Hungary / EU / Global)
  preferredCountry: 'HU',
  preferredCurrency: 'EUR',
};
