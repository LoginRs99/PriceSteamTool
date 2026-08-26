// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameDetailModal } from '../../src/client/src/components/GameDetailModal.js';
import { api } from '../../src/client/src/api.js';
import type { Game, Offer, PriceHistoryEntry, PriceIntelligenceResponse } from '../../src/client/src/types.js';

const mockGame: Game = {
  id: 'game-101',
  steamAppId: 1245620,
  title: 'Elden Ring',
  slug: 'elden-ring',
  isDlc: false,
  isFree: false,
  hasAnomaly: false,
  offersCount: 2,
  basePriceEur: 59.99,
  bestPriceEur: 35.99,
  bestDiscountPercent: 40,
  bestDealScore: 88,
  bestDealTier: 'Great',
  bestConfidenceScore: 95,
  bestMerchantName: 'Steam Store',
  bestMerchantIsOfficial: true,
  bestDealUrl: 'https://store.steampowered.com/app/1245620',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
};

const mockOffers: Offer[] = [
  {
    id: 'offer-1',
    gameId: 'game-101',
    merchantId: 'm-steam',
    merchantName: 'Steam Store',
    merchantCode: 'steam',
    isOfficial: true,
    priceEur: 35.99,
    originalPriceEur: 59.99,
    discountPercent: 40,
    productType: 'STEAM_KEY',
    regionType: 'GLOBAL',
    dealUrl: 'https://store.steampowered.com/app/1245620',
    priceEvent: 'NEW_HISTORICAL_LOW',
    riskLevel: 'SAFE',
    isBestDeal: true,
    isValid: true,
    isAnomaly: false,
    dealScore: 88,
    dealTier: 'Great',
    voucherCode: 'RING10',
    sources: ['steam', 'itad'],
    fetchedAt: '2026-01-01T00:00:00Z',
    lastObservedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'offer-2',
    gameId: 'game-101',
    merchantId: 'm-cdkeys',
    merchantName: 'CDKeys',
    merchantCode: 'cdkeys',
    isOfficial: false,
    priceEur: 32.50,
    originalPriceEur: 59.99,
    discountPercent: 46,
    productType: 'STEAM_KEY',
    regionType: 'GLOBAL',
    dealUrl: 'https://cdkeys.com/elden-ring',
    priceEvent: 'MAJOR_DROP',
    riskLevel: 'LOW',
    isBestDeal: false,
    isValid: true,
    isAnomaly: false,
    dealScore: 78,
    dealTier: 'Good',
    sources: ['allkeyshop'],
    fetchedAt: '2026-01-01T00:00:00Z',
    lastObservedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  }
];

const mockHistory: PriceHistoryEntry[] = [
  {
    id: 'h-1',
    gameId: 'game-101',
    merchantName: 'Steam Store',
    sourceCode: 'steam',
    priceEur: 35.99,
    discountPercent: 40,
    priceEvent: 'MAJOR_DROP',
    dealScore: 88,
    isOfficial: true,
    recordedAt: '2026-01-01T12:00:00Z'
  }
];

const mockIntelligence: PriceIntelligenceResponse = {
  gameId: 'game-101',
  currentPrice: {
    priceEur: 35.99,
    merchantName: 'Steam Store',
    isOfficial: true,
    discountPercent: 40
  },
  historicalContextSummary: 'Matches ATL',
  chartData: { points: [], minPrice: 35.99, maxPrice: 59.99, startDate: '2026-01-01', endDate: '2026-01-02' },
  advice: {
    decision: 'BUY',
    confidence: 'HIGH',
    headline: 'Strong historical value — match of all-time low',
    reasoning: ['At verified historical low price', 'Official store with safe activation']
  },
  periodLows: {
    low7d: { priceEur: 35.99, merchantName: 'Steam Store', isExactPeriodData: true, observationCount: 2 },
    low30d: { priceEur: 35.99, merchantName: 'Steam Store', isExactPeriodData: true, observationCount: 2 },
    low90d: { priceEur: 35.99, merchantName: 'Steam Store', isExactPeriodData: true, observationCount: 2 },
    low1y: { priceEur: 35.99, merchantName: 'Steam Store', isExactPeriodData: true, observationCount: 2 },
    allTimeLow: { priceEur: 35.99, isConfirmed: true, source: 'Steam' }
  },
  typicalSale: {
    medianPriceEur: 41.99,
    q1PriceEur: 35.99,
    q3PriceEur: 47.99,
    sampleCount: 6,
    isLowConfidence: false
  },
  frequency: {
    frequencyCategory: 'Frequent',
    saleEventsLast12m: 4,
    avgDaysBetweenSales: 60
  },
  volatility: {
    score: 85,
    category: 'Stable',
    priceChangesCount: 8,
    rawCv: 0.12
  },
  marketComparison: {
    currentRank: 1,
    totalCompatibleOffers: 2,
    percentBelowMarketMedian: 14,
    marketMedianEur: 41.99
  }
};

describe('GameDetailModal Component (Monolith & Decomposed Regression Tests)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getGameDetails').mockResolvedValue({
      game: mockGame,
      offers: mockOffers,
      history: mockHistory
    });
    vi.spyOn(api, 'getPriceIntelligence').mockResolvedValue(mockIntelligence);
  });

  it('renders loading state initially and then displays game details, decision hero, and offers', async () => {
    render(<GameDetailModal gameId="game-101" onClose={() => {}} />);

    expect(screen.getByText('Loading price intelligence & deal history...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Elden Ring' })).toBeInTheDocument();
    });

    expect(screen.getByText('BUY')).toBeInTheDocument();
    expect(screen.getByText('Strong historical value — match of all-time low')).toBeInTheDocument();
    expect(screen.getByText('Steam Store (AppID: 1245620)')).toBeInTheDocument();
    expect(screen.getByText('All Available Offers (2)')).toBeInTheDocument();
    expect(screen.getByText('CDKeys')).toBeInTheDocument();
  });

  it('allows configuring and saving a custom Target Price alert', async () => {
    const setTargetSpy = vi.spyOn(api, 'setTargetPrice').mockResolvedValue({ success: true } as any);
    const targetUpdatedCb = vi.fn();

    render(<GameDetailModal gameId="game-101" onClose={() => {}} onTargetPriceUpdated={targetUpdatedCb} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Elden Ring' })).toBeInTheDocument();
    });

    const targetInput = screen.getByPlaceholderText('e.g. 14.99');
    fireEvent.change(targetInput, { target: { value: '25.00' } });

    const setTargetBtn = screen.getByRole('button', { name: /Set Target/i });
    await act(async () => {
      fireEvent.click(setTargetBtn);
    });

    expect(setTargetSpy).toHaveBeenCalledWith('game-101', 25.00);
    expect(targetUpdatedCb).toHaveBeenCalledWith('game-101', 25.00);
  });

  it('copies voucher code to clipboard when voucher button is clicked', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock
      }
    });

    render(<GameDetailModal gameId="game-101" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('RING10')).toBeInTheDocument();
    });

    const voucherBtn = screen.getByText('RING10');
    await act(async () => {
      fireEvent.click(voucherBtn);
    });

    expect(writeTextMock).toHaveBeenCalledWith('RING10');
  });

  it('interacts with AllKeyShop candidate selector and applies override', async () => {
    vi.spyOn(api, 'getAllkeyshopCandidates').mockResolvedValue({
      gameId: 'game-101',
      title: 'Elden Ring',
      steamAppId: 1245620,
      candidates: [
        { id: 4567, name: 'Elden Ring Standard Edition PC', slug: 'buy-elden-ring-cd-key-compare-prices' }
      ],
      currentOverride: null
    });
    const setOverrideSpy = vi.spyOn(api, 'setAllkeyshopOverride').mockResolvedValue({ success: true } as any);

    render(<GameDetailModal gameId="game-101" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Elden Ring' })).toBeInTheDocument();
    });

    // Open candidate selector
    const openAksBtn = screen.getByRole('button', { name: /Jelöltek megtekintése/i });
    await act(async () => {
      fireEvent.click(openAksBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Elden Ring Standard Edition PC')).toBeInTheDocument();
    });

    // Select candidate
    const selectCandBtn = screen.getByRole('button', { name: 'Kiválasztás' });
    await act(async () => {
      fireEvent.click(selectCandBtn);
    });

    expect(setOverrideSpy).toHaveBeenCalledWith('game-101', 'buy-elden-ring-cd-key-compare-prices');
  });

  it('triggers onClose when close button or Escape key is pressed', async () => {
    const handleClose = vi.fn();
    render(<GameDetailModal gameId="game-101" onClose={handleClose} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Elden Ring' })).toBeInTheDocument();
    });

    const closeBtn = screen.getByLabelText('Close modal');
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(2);
  });
});
