import { useState, useCallback, useEffect, useRef } from 'react';
import type { Game, WishlistFilterOptions } from '../types.js';
import { api } from '../api.js';

function parseFiltersFromUrl(): Partial<WishlistFilterOptions> {
  if (typeof window === 'undefined' || !window.location) return {};
  try {
    const params = new URLSearchParams(window.location.search);
    const result: Partial<WishlistFilterOptions> = {};
    if (params.has('q')) result.search = params.get('q') || '';
    if (params.has('sort')) result.sort = params.get('sort') as any;
    if (params.has('page')) result.page = parseInt(params.get('page')!, 10) || 1;
    if (params.has('limit')) result.limit = parseInt(params.get('limit')!, 10) || 50;
    if (params.has('atl')) result.allTimeLowOnly = params.get('atl') === '1';
    if (params.has('sale')) result.saleOnly = params.get('sale') === '1';
    if (params.has('major')) result.majorDealsOnly = params.get('major') === '1';
    if (params.has('score')) result.minDealScore = parseInt(params.get('score')!, 10) || undefined;
    if (params.has('minPrice')) result.minPrice = parseFloat(params.get('minPrice')!) || undefined;
    if (params.has('maxPrice')) result.maxPrice = parseFloat(params.get('maxPrice')!) || undefined;
    if (params.has('merchant')) result.merchantType = params.get('merchant') as any;
    if (params.has('hideErrors')) result.hidePricingErrors = params.get('hideErrors') === '1';
    return result;
  } catch {
    return {};
  }
}

function syncFiltersToUrl(filters: WishlistFilterOptions) {
  if (typeof window === 'undefined' || !window.location || !window.history?.replaceState) return;
  try {
    const params = new URLSearchParams();
    if (filters.search) params.set('q', filters.search);
    if (filters.sort && filters.sort !== 'best_value') params.set('sort', filters.sort);
    if (filters.page && filters.page > 1) params.set('page', String(filters.page));
    if (filters.limit && filters.limit !== 50) params.set('limit', String(filters.limit));
    if (filters.allTimeLowOnly) params.set('atl', '1');
    if (filters.saleOnly) params.set('sale', '1');
    if (filters.majorDealsOnly) params.set('major', '1');
    if (filters.minDealScore) params.set('score', String(filters.minDealScore));
    if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
    if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
    if (filters.merchantType && filters.merchantType !== 'all') params.set('merchant', filters.merchantType);
    if (filters.hidePricingErrors) params.set('hideErrors', '1');

    const qs = params.toString();
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  } catch {
    // ignore
  }
}

export function useWishlistGames(activeProfileId?: string, initialFilters?: WishlistFilterOptions) {
  const [games, setGames] = useState<Game[]>([]);
  const [totalGames, setTotalGames] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<WishlistFilterOptions>(() => {
    const urlFilters = parseFiltersFromUrl();
    const savedSort = localStorage.getItem('pricetool_sort') as any;
    const savedLimit = parseInt(localStorage.getItem('pricetool_limit') || '50', 10);
    return {
      sort: urlFilters.sort || savedSort || initialFilters?.sort || 'best_value',
      page: urlFilters.page || initialFilters?.page || 1,
      limit: urlFilters.limit || (!isNaN(savedLimit) && savedLimit > 0 ? savedLimit : (initialFilters?.limit || 50)),
      isFreeOnly: false,
      ...urlFilters
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
    syncFiltersToUrl(updated);
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
