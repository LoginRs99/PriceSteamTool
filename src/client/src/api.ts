import type { 
  Profile, 
  Game, 
  Offer, 
  PriceHistoryEntry, 
  SourceStatus, 
  SyncProgressUpdate, 
  WishlistFilterOptions, 
  Anomaly,
  SourceCode
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
    if (options.historicalLowOnly) params.set('historicalLowOnly', 'true');
    if (options.underPrice) params.set('underPrice', String(options.underPrice));
    if (options.merchantType) params.set('merchantType', options.merchantType);
    if (options.hasAnomaly) params.set('hasAnomaly', 'true');
    if (options.page) params.set('page', String(options.page));
    if (options.limit) params.set('limit', String(options.limit));

    const res = await fetch(`${API_BASE}/games?${params.toString()}`);
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
    const res = await fetch(`${API_BASE}/anomalies`);
    return res.json();
  },

  async dismissAnomaly(id: string): Promise<void> {
    await fetch(`${API_BASE}/anomalies/${id}/dismiss`, { method: 'POST' });
  }
};
