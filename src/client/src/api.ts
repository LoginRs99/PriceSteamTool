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
  PriceIntelligenceResponse,
  DiscordSettings
} from './types.js';

const API_BASE = '/api';

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let body: any;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
  }
  if (res.status === 204) {
    return undefined as unknown as T;
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
}

export const api = {
  // Profiles
  async getProfiles(): Promise<Profile[]> {
    return apiFetch<Profile[]>(`${API_BASE}/profiles`);
  },

  async createProfile(name: string, steamId: string, customUrl?: string, isFamily: boolean = false): Promise<Profile> {
    return apiFetch<Profile>(`${API_BASE}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, steamId, customUrl, isFamily })
    });
  },

  async setActiveProfile(id: string): Promise<void> {
    await apiFetch<void>(`${API_BASE}/profiles/${id}/active`, { method: 'PUT' });
  },

  async toggleFamilyProfile(id: string, isFamily?: boolean): Promise<{ success: boolean; isFamily: boolean }> {
    return apiFetch<{ success: boolean; isFamily: boolean }>(`${API_BASE}/profiles/${id}/family`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFamily })
    });
  },

  async syncFamilyLibrary(id: string): Promise<{ success: boolean; gameCount: number }> {
    return apiFetch<{ success: boolean; gameCount: number }>(`${API_BASE}/profiles/${id}/sync-family`, {
      method: 'POST'
    });
  },

  async deleteProfile(id: string): Promise<void> {
    await apiFetch<void>(`${API_BASE}/profiles/${id}`, { method: 'DELETE' });
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
    if (options.hideUnreleased) params.set('hideUnreleased', 'true');
    if (options.hideDlcs) params.set('hideDlcs', 'true');
    if (options.includeFreeGames) params.set('includeFreeGames', 'true');
    if (options.hideFamilyShared) params.set('hideFamilyShared', 'true');
    if (options.page) params.set('page', String(options.page));
    if (options.limit) params.set('limit', String(options.limit));

    return apiFetch<{
      games: Game[];
      total: number;
      activeProfile: Profile | null;
      page: number;
      limit: number;
    }>(`${API_BASE}/games?${params.toString()}`);
  },

  async getWishlistStatistics(): Promise<WishlistStatistics> {
    return apiFetch<WishlistStatistics>(`${API_BASE}/wishlist/statistics`);
  },

  async getBestDeals(limit: number = 50): Promise<{ deals: Game[] }> {
    return apiFetch<{ deals: Game[] }>(`${API_BASE}/wishlist/best-deals?limit=${limit}`);
  },

  async getGameDetails(id: string): Promise<{
    game: Game;
    offers: Offer[];
    history: PriceHistoryEntry[];
  }> {
    return apiFetch<{
      game: Game;
      offers: Offer[];
      history: PriceHistoryEntry[];
    }>(`${API_BASE}/games/${id}`);
  },

  async getPriceIntelligence(id: string): Promise<PriceIntelligenceResponse> {
    return apiFetch<PriceIntelligenceResponse>(`${API_BASE}/games/${id}/intelligence`);
  },

  async getAllkeyshopCandidates(id: string): Promise<{
    gameId: string;
    title: string;
    steamAppId: number;
    currentOverride: string | number | null;
    candidates: { id: number; name: string; slug?: string }[];
  }> {
    return apiFetch<{
      gameId: string;
      title: string;
      steamAppId: number;
      currentOverride: string | number | null;
      candidates: { id: number; name: string; slug?: string }[];
    }>(`${API_BASE}/games/${id}/allkeyshop-candidates`);
  },

  async setAllkeyshopOverride(id: string, override: string | number | null): Promise<{
    success: boolean;
    gameId: string;
    override: string | number | null;
    offersUpdated: number;
  }> {
    return apiFetch<{
      success: boolean;
      gameId: string;
      override: string | number | null;
      offersUpdated: number;
    }>(`${API_BASE}/games/${id}/allkeyshop-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ override })
    });
  },

  async refreshGame(id: string): Promise<{ success: boolean; gameId: string; offersCount: number }> {
    return apiFetch<{ success: boolean; gameId: string; offersCount: number }>(`${API_BASE}/games/${id}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeKeyshops: true })
    });
  },

  // Sync
  async startSync(options: { forceRefresh?: boolean; sources?: SourceCode[] } = {}): Promise<SyncProgressUpdate> {
    return apiFetch<SyncProgressUpdate>(`${API_BASE}/sync/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
  },

  async cancelSync(): Promise<void> {
    await apiFetch<void>(`${API_BASE}/sync/cancel`, { method: 'POST' });
  },

  async getSyncStatus(): Promise<SyncProgressUpdate> {
    return apiFetch<SyncProgressUpdate>(`${API_BASE}/sync/status`);
  },

  // Sources & Diagnostics
  async getSources(): Promise<SourceStatus[]> {
    return apiFetch<SourceStatus[]>(`${API_BASE}/sources`);
  },

  async toggleSource(code: SourceCode, isEnabled: boolean): Promise<void> {
    await apiFetch<void>(`${API_BASE}/sources/${code}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled })
    });
  },

  // Anomalies
  async getAnomalies(): Promise<Anomaly[]> {
    try {
      const data = await apiFetch<Anomaly[]>(`${API_BASE}/anomalies`);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  async dismissAnomaly(id: string): Promise<void> {
    await apiFetch<void>(`${API_BASE}/anomalies/${id}/dismiss`, { method: 'POST' });
  },

  async dismissAllAnomalies(): Promise<void> {
    await apiFetch<void>(`${API_BASE}/anomalies/dismiss-all`, { method: 'POST' });
  },

  // Discord Notifications
  async getDiscordSettings(): Promise<DiscordSettings> {
    return apiFetch<DiscordSettings>(`${API_BASE}/settings/discord`);
  },

  async saveDiscordSettings(settings: Partial<DiscordSettings>): Promise<DiscordSettings> {
    return apiFetch<DiscordSettings>(`${API_BASE}/settings/discord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
  },

  async testDiscordWebhook(webhookUrl?: string): Promise<{ success: boolean; message?: string }> {
    return apiFetch<{ success: boolean; message?: string }>(`${API_BASE}/settings/discord/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl })
    });
  },

  async setTargetPrice(gameId: string, targetPriceEur: number | null): Promise<{ success: boolean; gameId: string; targetPriceEur: number | null }> {
    return apiFetch<{ success: boolean; gameId: string; targetPriceEur: number | null }>(`${API_BASE}/wishlist/${gameId}/target-price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPriceEur })
    });
  },

  getOffersExportCsvUrl(): string {
    return `${API_BASE}/export/offers.csv`;
  }
};

