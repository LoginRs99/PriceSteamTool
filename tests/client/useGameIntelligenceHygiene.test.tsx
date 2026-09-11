import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useGameIntelligence } from '../../src/client/src/components/detail/useGameIntelligence.js';
import { api, type RefreshGameResult } from '../../src/client/src/api.js';
import type { Game, Offer, PriceIntelligenceResponse } from '../../src/client/src/types.js';

describe('Task 22: useGameIntelligence hygiene (response reuse, delayed AKS re-sync, harden clear)', () => {
  const initialGame: Game = {
    id: 'game-1',
    steamAppId: 100,
    title: 'Test Game',
    slug: 'test-game',
    isDlc: false,
    isFree: false,
    hasAnomaly: false,
    offersCount: 0,
    targetPriceEur: 25.00,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  };

  const initialOffers: Offer[] = [];

  const refreshedGame: Game = {
    ...initialGame,
    bestPriceEur: 19.99,
    targetPriceEur: 20.00
  };

  const refreshedOffers: Offer[] = [
    {
      id: 'offer-refreshed',
      gameId: 'game-1',
      merchantId: 'm1',
      merchantName: 'Steam',
      merchantCode: 'steam',
      isOfficial: true,
      productType: 'STEAM_KEY',
      regionType: 'GLOBAL',
      priceEur: 19.99,
      dealUrl: 'https://steam.example.com',
      isBestDeal: true,
      priceEvent: 'NEW_HISTORICAL_LOW',
      riskLevel: 'SAFE',
      isAnomaly: false,
      sources: ['steam'],
      fetchedAt: '2026-01-01T00:00:00Z',
      lastObservedAt: '2026-01-01T00:00:00Z'
    }
  ];

  const refreshResult: RefreshGameResult = {
    success: true,
    game: refreshedGame,
    offers: refreshedOffers,
    history: [],
    intelligence: null,
    refreshedAt: '2026-01-01T00:00:00Z',
    sourcesChecked: ['steam'],
    sourcesFailed: [],
    sourcesSkipped: [],
    circuitStates: { steam: 'NORMAL' }
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getGameDetails').mockResolvedValue({
      game: initialGame,
      offers: initialOffers,
      history: []
    });
    vi.spyOn(api, 'getPriceIntelligence').mockResolvedValue({} as PriceIntelligenceResponse);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handleRefreshGame populates state directly from response without double refetch', async () => {
    const refreshSpy = vi.spyOn(api, 'refreshGame').mockResolvedValue(refreshResult);
    const getDetailsSpy = vi.spyOn(api, 'getGameDetails');
    const getIntelSpy = vi.spyOn(api, 'getPriceIntelligence');
    const onGameUpdated = vi.fn();

    const { result } = renderHook(() => useGameIntelligence('game-1', () => {}, undefined, onGameUpdated));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data?.game.id).toBe('game-1');
    });

    // Reset details call counts from initial mount
    getDetailsSpy.mockClear();
    getIntelSpy.mockClear();

    // Trigger refresh
    await act(async () => {
      await result.current.handleRefreshGame();
    });

    // State should immediately reflect refreshedGame and refreshedOffers
    expect(result.current.data?.game.bestPriceEur).toBe(19.99);
    expect(result.current.data?.offers).toHaveLength(1);
    expect(result.current.data?.offers[0].id).toBe('offer-refreshed');
    expect(result.current.targetPriceInput).toBe('20.00');
    expect(onGameUpdated).toHaveBeenCalledWith('game-1');

    // Crucial: NO double refetch happened immediately after refreshGame!
    expect(getDetailsSpy).not.toHaveBeenCalled();
    expect(getIntelSpy).not.toHaveBeenCalled();
  });

  it('schedules ONE delayed re-fetch after 10 s', async () => {
    vi.spyOn(api, 'refreshGame').mockResolvedValue(refreshResult);
    const getDetailsSpy = vi.spyOn(api, 'getGameDetails');
    const getIntelSpy = vi.spyOn(api, 'getPriceIntelligence');
    const onGameUpdated = vi.fn();

    const { result } = renderHook(() => useGameIntelligence('game-1', () => {}, undefined, onGameUpdated));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    getDetailsSpy.mockClear();
    getIntelSpy.mockClear();

    vi.useFakeTimers();

    await act(async () => {
      await result.current.handleRefreshGame();
    });

    expect(getDetailsSpy).not.toHaveBeenCalled();

    // Advance 5 seconds - still not called
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getDetailsSpy).not.toHaveBeenCalled();

    // Advance remaining 5 seconds (total 10s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(getDetailsSpy).toHaveBeenCalledTimes(1);
    expect(getIntelSpy).toHaveBeenCalledTimes(1);
  });

  it('cancels delayed re-fetch when unmounted (guarded by mountedRef)', async () => {
    vi.spyOn(api, 'refreshGame').mockResolvedValue(refreshResult);
    const getDetailsSpy = vi.spyOn(api, 'getGameDetails');
    const getIntelSpy = vi.spyOn(api, 'getPriceIntelligence');

    const { result, unmount } = renderHook(() => useGameIntelligence('game-1', () => {}));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    getDetailsSpy.mockClear();
    getIntelSpy.mockClear();

    vi.useFakeTimers();

    await act(async () => {
      await result.current.handleRefreshGame();
    });

    // Unmount before 10s expires
    unmount();

    // Advance 10s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    // Delayed re-fetch should NEVER fire
    expect(getDetailsSpy).not.toHaveBeenCalled();
    expect(getIntelSpy).not.toHaveBeenCalled();
  });

  describe('handleClearTargetPrice hardening', () => {
    it('clears target price and fires onTargetPriceUpdated on success', async () => {
      const setTargetSpy = vi.spyOn(api, 'setTargetPrice').mockResolvedValue(undefined as any);
      const onTargetPriceUpdated = vi.fn();

      const { result } = renderHook(() => useGameIntelligence('game-1', () => {}, onTargetPriceUpdated));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.targetPriceInput).toBe('25.00');

      await act(async () => {
        await result.current.handleClearTargetPrice();
      });

      expect(setTargetSpy).toHaveBeenCalledWith('game-1', null);
      expect(result.current.targetPriceInput).toBe('');
      expect(result.current.data?.game.targetPriceEur).toBeUndefined();
      expect(onTargetPriceUpdated).toHaveBeenCalledWith('game-1', null);
    });

    it('catches error and preserves local state when setTargetPrice fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(api, 'setTargetPrice').mockRejectedValue(new Error('Network error'));
      const onTargetPriceUpdated = vi.fn();

      const { result } = renderHook(() => useGameIntelligence('game-1', () => {}, onTargetPriceUpdated));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.targetPriceInput).toBe('25.00');

      await act(async () => {
        await result.current.handleClearTargetPrice();
      });

      // Failed API call -> state not cleared, callback not fired
      expect(result.current.targetPriceInput).toBe('25.00');
      expect(result.current.data?.game.targetPriceEur).toBe(25.00);
      expect(onTargetPriceUpdated).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Failed to clear target price:', expect.any(Error));
    });
  });
});
