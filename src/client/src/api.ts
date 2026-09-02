import type { 
  Profile, 
  Game, 
  Offer, 
  PriceHistoryEntry, 
  SourceStatus, 
  SyncProgressUpdate, 
  WishlistFilterOptions, 
  WishlistStatistics,
  Anomaly,
  SourceCode,
  PriceIntelligenceResponse
} from './types.js';

const API_BASE = '/api';

export const api = {
  // Profiles
  async getProfiles(): Promise<Profile[]> {
    const res = await fetch(`${API_BASE}/profiles`);
    return res.json();
  },

  async createProfile(name: string, steamId: string, customUrl?: string): Promise<Profile> {
    const res = await fetch(`${API_BASE}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, steamId, customUrl })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create profile');
    }
    return res.json();
  },

  async setActiveProfile(id: string): Promise<void> {
    await fetch(`${API_BASE}/profiles/${id}/active`, { method: 'PUT' });
  },

  async deleteProfile(id: string): Promise<void> {
    await fetch(`${API_BASE}/profiles/${id}`, { method: 'DELETE' });
  },

  // Games & Wishlist
  async getWishlistGames(options: WishlistFilterOptions = {}): Promise<{
    games: Game[];
    total: number;
    activeProfile: Profile | null;
    page: number;
    limit: number;
  }> {
    const params = new URLSearchParams();
    if (options.search) params.set('search', options.search);
    if (options.sort) params.set('sort', options.sort);
    if (options.saleOnly) params.set('saleOnly', 'true');
    if (options.majorDealsOnly) params.set('majorDealsOnly', 'true');
    if (options.allTimeLowOnly) params.set('allTimeLowOnly', 'true');
    if (options.trustedOnly) params.set('trustedOnly', 'true');
    if (options.historicalLowOnly) params.set('historicalLowOnly', 'true');
    if (options.isFreeOnly !== undefined) params.set('isFreeOnly', String(options.isFreeOnly));
    if (options.underPrice) params.set('underPrice', String(options.underPrice));
    if (options.minPrice !== undefined) params.set('minPrice', String(options.minPrice));
    if (options.maxPrice !== undefined) params.set('maxPrice', String(options.maxPrice));
    if (options.minDiscount !== undefined) params.set('minDiscount', String(options.minDiscount));
    if (options.minDealScore !== undefined) params.set('minDealScore', String(options.minDealScore));
    if (options.minConfidence !== undefined) params.set('minConfidence', String(options.minConfidence));
    if (options.hideAnomalies) params.set('hideAnomalies', 'true');
    if (options.hideProvisional) params.set('hideProvisional', 'true');
    if (options.buyOnly) params.set('buyOnly', 'true');
    if (options.merchantType) params.set('merchantType', options.merchantType);
    if (options.hasAnomaly) params.set('hasAnomaly', 'true');
    if (options.page) params.set('page', String(options.page));
    if (options.limit) params.set('limit', String(options.limit));

    const res = await fetch(`${API_BASE}/games?${params.toString()}`);
    return res.json();
  },

  async getWishlistStatistics(): Promise<WishlistStatistics> {
    const res = await fetch(`${API_BASE}/wishlist/statistics`);
    return res.json();
  },

  async getBestDeals(limit: number = 50): Promise<{ deals: Game[] }> {
    const res = await fetch(`${API_BASE}/wishlist/best-deals?limit=${limit}`);
    return res.json();
  },

  async getGameDetails(id: string): Promise<{
    game: Game;
    offers: Offer[];
    history: PriceHistoryEntry[];
  }> {
    const res = await fetch(`${API_BASE}/games/${id}`);
    if (!res.ok) throw new Error('Failed to load game details');
    return res.json();
  },

  async getPriceIntelligence(id: string): Promise<PriceIntelligenceResponse> {
    const res = await fetch(`${API_BASE}/games/${id}/intelligence`);
    if (!res.ok) throw new Error('Failed to load price intelligence');
    return res.json();
  },

  async getAllkeyshopCandidates(id: string): Promise<{
    gameId: string;
    title: string;
    steamAppId: number;
    currentOverride: string | number | null;
    candidates: { id: number; name: string; slug?: string }[];
  }> {
    const res = await fetch(`${API_BASE}/games/${id}/allkeyshop-candidates`);
    if (!res.ok) throw new Error('Failed to load AllKeyShop candidates');
    return res.json();
  },

  async setAllkeyshopOverride(id: string, override: string | number | null): Promise<{
    success: boolean;
    gameId: string;
    override: string | number | null;
    offersUpdated: number;
  }> {
    const res = await fetch(`${API_BASE}/games/${id}/allkeyshop-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ override })
    });
    if (!res.ok) throw new Error('Failed to set AllKeyShop override');
    return res.json();
  },

  // Sync
  async startSync(options: { forceRefresh?: boolean; sources?: SourceCode[] } = {}): Promise<SyncProgressUpdate> {
    const res = await fetch(`${API_BASE}/sync/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to start sync');
    }
    return res.json();
  },

  async cancelSync(): Promise<void> {
    await fetch(`${API_BASE}/sync/cancel`, { method: 'POST' });
  },

  async getSyncStatus(): Promise<SyncProgressUpdate> {
    const res = await fetch(`${API_BASE}/sync/status`);
    return res.json();
  },

  // Sources & Diagnostics
  async getSources(): Promise<SourceStatus[]> {
    const res = await fetch(`${API_BASE}/sources`);
    return res.json();
  },

  async toggleSource(code: SourceCode, isEnabled: boolean): Promise<void> {
    await fetch(`${API_BASE}/sources/${code}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled })
    });
  },

  // Anomalies
  async getAnomalies(): Promise<Anomaly[]> {
    try {
      const res = await fetch(`${API_BASE}/anomalies`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  async dismissAnomaly(id: string): Promise<void> {
    await fetch(`${API_BASE}/anomalies/${id}/dismiss`, { method: 'POST' });
  },

  async dismissAllAnomalies(): Promise<void> {
    await fetch(`${API_BASE}/anomalies/dismiss-all`, { method: 'POST' });
  },

  // Discord Notifications
  async getDiscordSettings(): Promise<{
    webhookUrl: string;
    isEnabled: boolean;
    minDealScore: number;
    notifyAtlOnly: boolean;
    notifyFreeGames: boolean;
    cooldownHours: number;
  }> {
    const res = await fetch(`${API_BASE}/settings/discord`);
    return res.json();
  },

  async saveDiscordSettings(settings: {
    webhookUrl?: string;
    isEnabled?: boolean;
    minDealScore?: number;
    notifyAtlOnly?: boolean;
    notifyFreeGames?: boolean;
    cooldownHours?: number;
  }): Promise<any> {
    const res = await fetch(`${API_BASE}/settings/discord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save Discord settings');
    }
    return res.json();
  },

  async testDiscordWebhook(webhookUrl?: string): Promise<{ success: boolean; message?: string }> {
    const res = await fetch(`${API_BASE}/settings/discord/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Discord webhook test failed');
    }
    return res.json();
  },

  async setTargetPrice(gameId: string, targetPriceEur: number | null): Promise<{ success: boolean; gameId: string; targetPriceEur: number | null }> {
    const res = await fetch(`${API_BASE}/wishlist/${gameId}/target-price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPriceEur })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update target price');
    }
    return res.json();
  },

  getOffersExportCsvUrl(): string {
    return `${API_BASE}/export/offers.csv`;
  }
};
