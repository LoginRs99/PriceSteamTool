import { useState, useCallback, useEffect, useRef } from 'react';
import type { WishlistStatistics, Game } from '../types.js';
import { api, type BestDealsParams } from '../api.js';

export function useWishlistStats(activeProfileId?: string) {
  const [stats, setStats] = useState<WishlistStatistics | null>(null);
  const [topDeals, setTopDeals] = useState<Game[]>([]);
  const [topDealsTotal, setTopDealsTotal] = useState<number>(0);
  const [topDealsPage, setTopDealsPage] = useState<number>(1);
  const [topDealsTotalPages, setTopDealsTotalPages] = useState<number>(1);
  const [isDealsLoading, setIsDealsLoading] = useState<boolean>(false);
  const [freeGames, setFreeGames] = useState<Game[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadTopDeals = useCallback(async (params?: BestDealsParams) => {
    if (!activeProfileId) return;
    setIsDealsLoading(true);
    try {
      const d = await api.getBestDeals(params || { limit: 50 });
      if (isMountedRef.current) {
        setTopDeals(d.deals || []);
        setTopDealsTotal(d.total ?? d.deals?.length ?? 0);
        setTopDealsPage(d.page ?? 1);
        setTopDealsTotalPages(d.totalPages ?? 1);
      }
    } catch (e) {
      if (isMountedRef.current) {
        console.error('Failed to load best deals:', e);
      }
    } finally {
      if (isMountedRef.current) {
        setIsDealsLoading(false);
      }
    }
  }, [activeProfileId]);

  const loadStatsAndDeals = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      const [s, d] = await Promise.all([
        api.getWishlistStatistics(),
        api.getBestDeals(50)
      ]);
      if (isMountedRef.current) {
        setStats(s);
        setTopDeals(d.deals || []);
        setTopDealsTotal(d.total ?? d.deals?.length ?? 0);
        setTopDealsPage(d.page ?? 1);
        setTopDealsTotalPages(d.totalPages ?? 1);
      }
    } catch (e) {
      if (isMountedRef.current) {
        console.error('Failed to load statistics or best deals:', e);
      }
    }
  }, [activeProfileId]);

  const loadFreeGames = useCallback(async () => {
    if (!activeProfileId) return;
    try {
      const res = await api.getWishlistGames({ isFreeOnly: true, limit: 500 });
      if (isMountedRef.current) {
        setFreeGames(res.games || []);
      }
    } catch (e) {
      if (isMountedRef.current) {
        console.error('Failed to load free games:', e);
      }
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
    topDealsTotal,
    topDealsPage,
    topDealsTotalPages,
    isDealsLoading,
    loadTopDeals,
    freeGames,
    setFreeGames,
    loadStatsAndDeals,
    loadFreeGames
  };
}
