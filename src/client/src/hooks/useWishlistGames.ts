import { useState, useCallback, useEffect, useRef } from 'react';
import type { Game, WishlistFilterOptions } from '../types.js';
import { api } from '../api.js';

export function useWishlistGames(activeProfileId?: string, initialFilters?: WishlistFilterOptions) {
  const [games, setGames] = useState<Game[]>([]);
  const [totalGames, setTotalGames] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<WishlistFilterOptions>(() => {
    const savedSort = localStorage.getItem('pricetool_sort') as any;
    const savedLimit = parseInt(localStorage.getItem('pricetool_limit') || '50', 10);
    return {
      sort: savedSort || initialFilters?.sort || 'best_value',
      page: initialFilters?.page || 1,
      limit: !isNaN(savedLimit) && savedLimit > 0 ? savedLimit : (initialFilters?.limit || 50),
      isFreeOnly: false
    };
  });

  const requestCounter = useRef(0);

  const loadGames = useCallback(async (opts: WishlistFilterOptions = filters) => {
    if (!activeProfileId) {
      setGames([]);
      setTotalGames(0);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestCounter.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getWishlistGames({ ...opts, isFreeOnly: false });
      if (requestId === requestCounter.current) {
        setGames(res.games || []);
        setTotalGames(res.total || 0);
      }
    } catch (e: any) {
      if (requestId === requestCounter.current) {
        console.error('Failed to load wishlist games:', e);
        setError(e?.message || 'Failed to load games from server.');
      }
    } finally {
      if (requestId === requestCounter.current) {
        setLoading(false);
      }
    }
  }, [activeProfileId, filters]);

  const updateFilters = useCallback((newFilters: Partial<WishlistFilterOptions>) => {
    const updated = { ...filters, ...newFilters };
    if (newFilters.sort) {
      localStorage.setItem('pricetool_sort', newFilters.sort);
    }
    if (newFilters.limit) {
      localStorage.setItem('pricetool_limit', String(newFilters.limit));
    }
    setFilters(updated);
    loadGames(updated);
  }, [filters, loadGames]);

  useEffect(() => {
    if (activeProfileId) {
      loadGames(filters);
    }
  }, [activeProfileId]);

  return {
    games,
    setGames,
    totalGames,
    loading,
    error,
    filters,
    setFilters,
    updateFilters,
    loadGames
  };
}
