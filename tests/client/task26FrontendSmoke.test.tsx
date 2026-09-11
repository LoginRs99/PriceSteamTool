// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { OffersTable } from '../../src/client/src/components/detail/OffersTable.js';
import { IntelMetricsGrid } from '../../src/client/src/components/detail/IntelMetricsGrid.js';
import { FilterBar } from '../../src/client/src/components/FilterBar.js';
import { SyncBanner } from '../../src/client/src/components/SyncBanner.js';
import { useWishlistSync } from '../../src/client/src/hooks/useWishlistSync.js';
import { renderHook } from '@testing-library/react';
import type { Offer, SyncProgressUpdate } from '../../src/client/src/types.js';

describe('Task 26 Frontend Smoke Verification Suite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. Partial-failure sync (COMPLETED_WITH_WARNINGS) -> Amber banner, data refresh & 10s auto-dismiss
  it('renders amber warning banner on COMPLETED_WITH_WARNINGS and triggers onSyncCompleted and auto-dismisses after 10s', () => {
    const mockOnSyncCompleted = vi.fn();
    let mockEventSourceInstance: any;

    class MockEventSource {
      onmessage: ((event: { data: string }) => void) | null = null;
      close = vi.fn();
      constructor(url: string) {
        mockEventSourceInstance = this;
      }
    }
    vi.stubGlobal('EventSource', MockEventSource);

    const { result } = renderHook(() => useWishlistSync(mockOnSyncCompleted));

    // Initially idle
    expect(result.current.syncProgress).toBeNull();

    // Trigger COMPLETED_WITH_WARNINGS update via SSE
    const warningUpdate: SyncProgressUpdate = {
      status: 'COMPLETED_WITH_WARNINGS',
      currentAction: 'Some sources encountered rate limits or transient errors',
      totalGames: 10,
      processedGames: 10,
      startTime: Date.now() - 5000,
      sourceProgress: {
        steam: { processed: 10, total: 10, offersFound: 10, state: 'NORMAL' },
        itad: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' },
        ggdeals: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' },
        cheapshark: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' },
        allkeyshop: { processed: 0, total: 0, offersFound: 0, state: 'NORMAL' }
      }
    };

    act(() => {
      mockEventSourceInstance.onmessage?.({ data: JSON.stringify(warningUpdate) });
    });

    // onSyncCompleted must be invoked
    expect(mockOnSyncCompleted).toHaveBeenCalledTimes(1);
    expect(result.current.syncProgress?.status).toBe('COMPLETED_WITH_WARNINGS');

    // Render SyncBanner with this progress
    render(
      <SyncBanner progress={result.current.syncProgress} onCancel={() => {}} />
    );

    expect(screen.getByText('Sync Finished (with warnings)')).toBeInTheDocument();

    // Fast-forward 9.9 seconds: banner still present
    act(() => {
      vi.advanceTimersByTime(9900);
    });
    expect(result.current.syncProgress).not.toBeNull();

    // Fast-forward past 10 seconds: banner auto-dismisses to null
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.syncProgress).toBeNull();

    vi.unstubAllGlobals();
  });

  // 2. Search debouncing: <= 1 request / 300 ms burst
  it('search input debounces rapid typing bursts to 1 filter change after 300ms', () => {
    const onFilterChange = vi.fn();
    render(
      <FilterBar
        filters={{ search: '', page: 1, limit: 50, sort: 'priority' }}
        totalGames={100}
        onFilterChange={onFilterChange}
      />
    );

    const searchInput = screen.getByPlaceholderText(/Search wishlist games/i);

    // Rapid bursts of 5 keystrokes
    fireEvent.change(searchInput, { target: { value: 'C' } });
    fireEvent.change(searchInput, { target: { value: 'Cy' } });
    fireEvent.change(searchInput, { target: { value: 'Cyb' } });
    fireEvent.change(searchInput, { target: { value: 'Cybe' } });
    fireEvent.change(searchInput, { target: { value: 'Cyber' } });

    // Before 300ms: 0 calls
    expect(onFilterChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onFilterChange).not.toHaveBeenCalled();

    // After 300ms: exactly 1 call with the final value
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith({ search: 'Cyber', page: 1 });
  });

  // 3. SSE survives filter changes
  it('useWishlistSync EventSource connection is stable across re-renders / filter changes', () => {
    let constructorCallCount = 0;
    class MockEventSource {
      close = vi.fn();
      constructor(url: string) {
        constructorCallCount++;
      }
    }
    vi.stubGlobal('EventSource', MockEventSource);

    const onCompleted1 = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ onCompleted }) => useWishlistSync(onCompleted),
      { initialProps: { onCompleted: onCompleted1 } }
    );

    expect(constructorCallCount).toBe(1);

    // Re-render hook with a new callback reference (simulating parent state/filter re-render)
    const onCompleted2 = vi.fn();
    rerender({ onCompleted: onCompleted2 });

    // Connection must not have been torn down or re-created
    expect(constructorCallCount).toBe(1);

    unmount();
    vi.unstubAllGlobals();
  });

  // 4. Object.freeze smoke test on offers prop in OffersTable
  it('OffersTable does not throw or mutate props when given an Object.freeze array', () => {
    const rawOffers: Offer[] = [
      {
        id: 'off-1',
        gameId: 'g-1',
        merchantId: 'm-1',
        merchantName: 'Steam Store',
        merchantCode: 'steam',
        isOfficial: true,
        priceEur: 29.99,
        originalPriceEur: 59.99,
        discountPercent: 50,
        productType: 'DIRECT_PURCHASE',
        regionType: 'GLOBAL',
        dealUrl: 'https://store.steampowered.com/app/1',
        priceEvent: 'NONE',
        isBestDeal: true,
        isValid: true,
        isFresh: true,
        isLikelyPricingError: false,
        dealScore: 70,
        dealTier: 'Good',
        sources: ['steam'],
        fetchedAt: new Date().toISOString(),
        lastObservedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'off-2',
        gameId: 'g-1',
        merchantId: 'm-2',
        merchantName: 'Cheap Keys',
        merchantCode: 'keys',
        isOfficial: false,
        priceEur: 19.99,
        originalPriceEur: 59.99,
        discountPercent: 67,
        productType: 'STEAM_KEY',
        regionType: 'GLOBAL',
        dealUrl: 'https://keys.com/deal',
        priceEvent: 'MAJOR_DROP',
        isBestDeal: false,
        isValid: true,
        isFresh: true,
        isLikelyPricingError: false,
        dealScore: 80,
        dealTier: 'Great',
        sources: ['cheapshark'],
        fetchedAt: new Date().toISOString(),
        lastObservedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
    const frozenOffers = Object.freeze(rawOffers) as unknown as Offer[];

    expect(() => {
      render(
        <OffersTable
          offers={frozenOffers}
          copiedVoucherId={null}
          onCopyVoucher={() => {}}
        />
      );
    }).not.toThrow();

    expect(frozenOffers[0].priceEur).toBe(29.99);
    expect(frozenOffers[1].priceEur).toBe(19.99);
  });

  // 5. Typical Sale card renders "—" when intelligence fails / is missing
  it('IntelMetricsGrid renders "—" and "Insufficient historical sale data" when intelligence typicalSale is missing', () => {
    render(
      <IntelMetricsGrid
        intelligence={undefined}
      />
    );

    // Typical sale card renders —
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Insufficient historical sales')).toBeInTheDocument();
  });
});
