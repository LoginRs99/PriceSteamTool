export const SCHEMA_SQL = `
-- Pragmas for high performance and durability
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  steam_id TEXT UNIQUE NOT NULL,
  custom_url TEXT,
  avatar_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. Games Table
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  steam_app_id INTEGER UNIQUE NOT NULL,
  itad_id TEXT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  header_image TEXT,
  capsule_image TEXT,
  release_date TEXT,
  is_dlc INTEGER NOT NULL DEFAULT 0,
  is_free INTEGER NOT NULL DEFAULT 0,
  base_price_eur REAL,
  historical_low_eur REAL,
  historical_low_date TEXT,
  historical_low_source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_steam_app_id ON games(steam_app_id);
CREATE INDEX IF NOT EXISTS idx_games_itad_id ON games(itad_id);
CREATE INDEX IF NOT EXISTS idx_games_title ON games(title);

-- 3. Wishlist Entries Table
CREATE TABLE IF NOT EXISTS wishlist_entries (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  date_added_steam TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT NOT NULL,
  UNIQUE(profile_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_profile_game ON wishlist_entries(profile_id, game_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_priority ON wishlist_entries(priority);

-- 4. Merchants Table
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  default_url TEXT,
  is_official INTEGER NOT NULL DEFAULT 1,
  trust_score REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_merchants_code ON merchants(code);

-- 5. Offers Table
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL, -- STEAM_KEY, STEAM_GIFT, DIRECT_PURCHASE
  region_type TEXT NOT NULL,  -- GLOBAL, EU, HU, RESTRICTED
  region_code TEXT,
  region_confidence REAL NOT NULL DEFAULT 1.0,
  price_eur REAL NOT NULL,
  original_price_eur REAL,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  voucher_code TEXT,
  deal_url TEXT NOT NULL,
  is_best_deal INTEGER NOT NULL DEFAULT 0,
  is_valid INTEGER NOT NULL DEFAULT 1,
  is_anomaly INTEGER NOT NULL DEFAULT 0,
  anomaly_score REAL NOT NULL DEFAULT 0.0,
  anomaly_reason TEXT,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(game_id, merchant_id, product_type, region_type)
);

CREATE INDEX IF NOT EXISTS idx_offers_game_id ON offers(game_id);
CREATE INDEX IF NOT EXISTS idx_offers_best_valid ON offers(game_id, is_valid, is_best_deal);
CREATE INDEX IF NOT EXISTS idx_offers_price ON offers(price_eur);

-- 6. Source Observations Table
CREATE TABLE IF NOT EXISTS source_observations (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  source_code TEXT NOT NULL,
  observed_price_eur REAL NOT NULL,
  observed_at TEXT NOT NULL,
  raw_data_json TEXT,
  UNIQUE(offer_id, source_code)
);

CREATE INDEX IF NOT EXISTS idx_observations_offer ON source_observations(offer_id);

-- 7. Price History Table
CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  source_code TEXT NOT NULL,
  price_eur REAL NOT NULL,
  discount_percent INTEGER,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_game ON price_history(game_id, recorded_at);

-- 8. Sources Metadata Table
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 10,
  state TEXT NOT NULL DEFAULT 'NORMAL',
  request_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  rate_limit_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_error TEXT,
  cooldown_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 9. Sync Runs Table
CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL DEFAULT 'MANUAL',
  status TEXT NOT NULL DEFAULT 'RUNNING',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  total_games INTEGER NOT NULL DEFAULT 0,
  processed_games INTEGER NOT NULL DEFAULT 0,
  offers_found INTEGER NOT NULL DEFAULT 0,
  offers_updated INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

-- 10. Anomalies Table
CREATE TABLE IF NOT EXISTS anomalies (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  anomaly_type TEXT NOT NULL,
  score REAL NOT NULL,
  reason TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  is_dismissed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_anomalies_game ON anomalies(game_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_dismissed ON anomalies(is_dismissed);
`;

export const SEED_SOURCES_SQL = `
INSERT OR IGNORE INTO sources (id, code, name, is_enabled, priority, state, created_at, updated_at) VALUES
('src-steam', 'steam', 'Steam Storefront', 1, 1, 'NORMAL', datetime('now'), datetime('now')),
('src-itad', 'itad', 'IsThereAnyDeal', 1, 2, 'NORMAL', datetime('now'), datetime('now')),
('src-ggdeals', 'ggdeals', 'GG.deals', 1, 3, 'NORMAL', datetime('now'), datetime('now')),
('src-cheapshark', 'cheapshark', 'CheapShark', 1, 4, 'NORMAL', datetime('now'), datetime('now')),
('src-allkeyshop', 'allkeyshop', 'AllKeyShop', 0, 5, 'NORMAL', datetime('now'), datetime('now')),
('src-gocdkeys', 'gocdkeys', 'GoCDKeys', 0, 6, 'NORMAL', datetime('now'), datetime('now'));
`;
