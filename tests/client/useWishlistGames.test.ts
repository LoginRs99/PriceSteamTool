// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWishlistGames } from '../../src/client/src/hooks/useWishlistGames.js';

vi.mock('../../src/client/src/api.js', () => ({
  api: {
    getWishlistGames: vi.fn().mockResolvedValue({
      games: [],
      total: 0,
      page: 1,
      limit: 50,
      totalPages: 1
    })
  }
}));

describe('useWishlistGames URL Synchronization and State Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('initializes filters from URL query parameters', async () => {
    window.history.replaceState({}, '', '/?q=hades&sort=near_atl&page=2&limit=24&atl=1&sale=1&merchant=official');

    let hookResult: any;
    await act(async () => {
      hookResult = renderHook(() => useWishlistGames('profile-1')).result;
    });

    expect(hookResult.current.filters.search).toBe('hades');
    expect(hookResult.current.filters.sort).toBe('near_atl');
    expect(hookResult.current.filters.page).toBe(2);
    expect(hookResult.current.filters.limit).toBe(24);
    expect(hookResult.current.filters.allTimeLowOnly).toBe(true);
    expect(hookResult.current.filters.saleOnly).toBe(true);
    expect(hookResult.current.filters.merchantType).toBe('official');
  });

  it('syncs filter updates to browser URL query parameters', () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    const { result } = renderHook(() => useWishlistGames('profile-1'));

    act(() => {
      result.current.updateFilters({
        search: 'witcher',
        sort: 'biggest_savings',
        majorDealsOnly: true,
        page: 1
      });
    });

    expect(result.current.filters.search).toBe('witcher');
    expect(result.current.filters.sort).toBe('biggest_savings');
    expect(result.current.filters.majorDealsOnly).toBe(true);

    expect(replaceStateSpy).toHaveBeenCalled();
    const lastCallArg = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1][2] as string;
    expect(lastCallArg).toContain('q=witcher');
    expect(lastCallArg).toContain('sort=biggest_savings');
    expect(lastCallArg).toContain('major=1');
  });

  it('cleans up default URL query parameters when filters are reset', () => {
    window.history.replaceState({}, '', '/?q=witcher&sort=biggest_savings&major=1');
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    const { result } = renderHook(() => useWishlistGames('profile-1'));

    act(() => {
      result.current.updateFilters({
        search: '',
        sort: 'priority',
        majorDealsOnly: false,
        page: 1
      });
    });

    expect(replaceStateSpy).toHaveBeenCalled();
    const lastCallArg = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1][2] as string;
    expect(lastCallArg).not.toContain('q=');
    expect(lastCallArg).not.toContain('major=');
  });
});
