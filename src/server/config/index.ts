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
  dbPath: process.env.DB_PATH || path.join(DATA_DIR, 'pricetool.db'),
  isDev: process.env.NODE_ENV !== 'production',
  
  // API Keys
  steamApiKey: process.env.STEAM_API_KEY || '',
  itadApiKey: process.env.ITAD_API_KEY || '',
  ggdealsApiKey: process.env.GGDEALS_API_KEY || '',
  
  // Source Pacing Defaults (ms) - Optimized for batch APIs & respectful scraping
  delays: {
    steam: parseInt(process.env.STEAM_DELAY_MS || '2000', 10),
    itad: parseInt(process.env.ITAD_DELAY_MS || '1000', 10),
    ggdeals: parseInt(process.env.GGDEALS_DELAY_MS || '1500', 10),
    cheapshark: parseInt(process.env.CHEAPSHARK_DELAY_MS || '1500', 10),
    nexarda: parseInt(process.env.NEXARDA_DELAY_MS || '500', 10),
    superduperbundle: parseInt(process.env.SUPERDUPERBUNDLE_DELAY_MS || '1000', 10)
  },

  // Stealth & Anti-Ban Batching for Chunked Aggregator Sources
  ggdealsChunkPauseMs: parseInt(process.env.GGDEALS_CHUNK_PAUSE_MS || '60000', 10),
  cheapsharkChunkPauseMs: parseInt(process.env.CHEAPSHARK_CHUNK_PAUSE_MS || '3000', 10),
  superduperbundleChunkPauseMs: parseInt(process.env.SUPERDUPERBUNDLE_CHUNK_PAUSE_MS || '2500', 10),

  // Cache & Periodic Auto-Sync settings
  cacheTtlHours: parseInt(process.env.CACHE_TTL_HOURS || '6', 10),
  historyRetentionDays: parseInt(process.env.HISTORY_RETENTION_DAYS || '365', 10),
  autoSyncEnabled: process.env.AUTO_SYNC_ENABLED !== 'false',
  autoSyncIntervalHours: parseInt(process.env.AUTO_SYNC_INTERVAL_HOURS || '6', 10),

  // Modern Keyshop & Aggregator Sources (Phase 2)
  nexardaEnabled: process.env.NEXARDA_ENABLED !== 'false',
  superduperbundleEnabled: process.env.SUPERDUPERBUNDLE_ENABLED !== 'false',
  superduperbundleApiKey: process.env.SUPERDUPERBUNDLE_API_KEY || '',

  // Database Backup Settings
  backupEnabled: process.env.BACKUP_ENABLED !== 'false',
  backupIntervalHours: parseInt(process.env.BACKUP_INTERVAL_HOURS || '24', 10),
  backupRetentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10),

  // Region preferences (default: Hungary / EU / Global)
  preferredCountry: 'HU',
  preferredCurrency: 'EUR',

  // Security & Access Control
  trustedOrigins: process.env.TRUSTED_ORIGINS 
    ? process.env.TRUSTED_ORIGINS
        .split(',')
        .map(o => o.trim().replace(/\/+$/, ''))
        .filter(Boolean) 
    : null,
  apiToken: process.env.API_TOKEN?.trim() || '',
  trustProxy: process.env.TRUST_PROXY === 'true',
  v1RateLimitPerMinute: parseInt(process.env.V1_RATE_LIMIT_PER_MIN || '300', 10),
};
