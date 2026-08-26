import { useState, useCallback, useEffect } from 'react';
import type { WishlistStatistics, Game } from '../types.js';
import { api } from '../api.js';

export function useWishlistStats(activeProfileId?: string) {
  const [stats, setStats] = useState<WishlistStatistics | null>(null);
  const [topDeals, setTopDeals] = useState<Game[]>([]);
  const [freeGames, setFreeGames] = useState<Game[]>([]);

  const loadStatsAndDeals = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      const [s, d] = await Promise.all([
        api.getWishlistStatistics(),
        api.getBestDeals(12)
      ]);
      setStats(s);
      setTopDeals(d.deals || []);
    } catch (e) {
      console.error('Failed to load statistics or best deals:', e);
    }
  }, [activeProfileId]);

  const loadFreeGames = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      const res = await api.getWishlistGames({ isFreeOnly: true, limit: 500 });
      setFreeGames(res.games || []);
    } catch (e) {
      console.error('Failed to load free games:', e);
    }
  }, [activeProfileId]);

  useEffect(() => {
    if (activeProfileId) {
      loadStatsAndDeals();
      loadFreeGames();
    }
  }, [activeProfileId, loadStatsAndDeals, loadFreeGames]);

  return {
    stats,
    topDeals,
    setTopDeals,
    freeGames,
    setFreeGames,
    loadStatsAndDeals,
    loadFreeGames
  };
}
