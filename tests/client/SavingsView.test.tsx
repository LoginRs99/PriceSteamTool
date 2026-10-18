// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SavingsView } from '../../src/client/src/components/SavingsView.js';
import { api } from '../../src/client/src/api.js';
import { CurrencyProvider } from '../../src/client/src/context/CurrencyContext.js';
import type { Purchase, SavingsSummary } from '../../src/client/src/types.js';

vi.mock('../../src/client/src/api.js', () => ({
  api: {
    getPurchases: vi.fn(),
    getSavingsSummary: vi.fn(),
    deletePurchase: vi.fn(),
    getExchangeRates: vi.fn().mockResolvedValue({ base: 'EUR', rates: { EUR: 1, USD: 1.08 } })
  }
}));

const mockSummary: SavingsSummary = {
  totalSpentEur: 24.98,
  totalSavedVsMsrpEur: 65,
  totalSavedVsMedianEur: 15,
  totalPurchases: 2,
  monthly: [
    {
      month: '2026-09',
      spentEur: 24.98,
      savedVsMsrpEur: 65,
      savedVsMedianEur: 15,
      count: 2
    }
  ]
};

const mockPurchases: Purchase[] = [
  {
    id: 'pur-1',
    profileId: 'prof-1',
    gameId: 'game-1',
    gameTitle: 'The Witcher 3',
    merchantName: 'GOG.com',
    priceEur: 4.99,
    savingsVsMsrpEur: 25,
    savingsVsMedianEur: 5,
    purchasedAt: '2026-09-10T10:00:00.000Z',
    createdAt: '2026-09-10T10:00:00.000Z'
  },
  {
    id: 'pur-2',
    profileId: 'prof-1',
    gameId: 'game-2',
    gameTitle: 'Cyberpunk 2077',
    merchantName: 'Steam',
    priceEur: 19.99,
    savingsVsMsrpEur: 40,
    savingsVsMedianEur: 10,
    purchasedAt: '2026-09-15T12:00:00.000Z',
    createdAt: '2026-09-15T12:00:00.000Z'
  }
];

describe('SavingsView (Anti-UI-Slop & Craftsmanship)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders SavingsSkeleton layout on initial load without layout shift', () => {
    // Return a pending promise so loading state persists
    vi.mocked(api.getPurchases).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.getSavingsSummary).mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <CurrencyProvider>
        <SavingsView profileId="prof-1" />
      </CurrencyProvider>
    );

    expect(container.querySelector('.savings-skeleton-container')).toBeInTheDocument();
  });

  it('renders crafted empty state with helpful steps when purchases list is empty', async () => {
    vi.mocked(api.getPurchases).mockResolvedValue([]);
    vi.mocked(api.getSavingsSummary).mockResolvedValue({
      totalSpentEur: 0,
      totalSavedVsMsrpEur: 0,
      totalSavedVsMedianEur: 0,
      totalPurchases: 0,
      monthly: []
    });

    render(
      <CurrencyProvider>
        <SavingsView profileId="prof-1" />
      </CurrencyProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('No purchases recorded yet')).toBeInTheDocument();
    });

    expect(screen.getByText(/Track your real-world savings/)).toBeInTheDocument();
    expect(screen.getByText(/Navigate to any game/)).toBeInTheDocument();
    expect(screen.getByText(/"I Bought It"/)).toBeInTheDocument();
  });

  it('renders loaded purchases, KPI cards, and monthly breakdown', async () => {
    vi.mocked(api.getPurchases).mockResolvedValue(mockPurchases);
    vi.mocked(api.getSavingsSummary).mockResolvedValue(mockSummary);

    const onSelectGame = vi.fn();

    render(
      <CurrencyProvider>
        <SavingsView profileId="prof-1" onSelectGame={onSelectGame} />
      </CurrencyProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('The Witcher 3')).toBeInTheDocument();
      expect(screen.getByText('Cyberpunk 2077')).toBeInTheDocument();
    });

    // Check KPI cards
    expect(screen.getByText('Total Spent')).toBeInTheDocument();
    expect(screen.getAllByText('Savings (MSRP)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Sale Beat')).toBeInTheDocument();

    // Check Monthly Breakdown
    expect(screen.getByText('Monthly Savings Breakdown')).toBeInTheDocument();
    expect(screen.getByText('2026-09')).toBeInTheDocument();

    // Click on game title
    fireEvent.click(screen.getByText('The Witcher 3'));
    expect(onSelectGame).toHaveBeenCalledWith('game-1');
  });

  it('renders explicit error state with Retry button when fetch fails', async () => {
    vi.mocked(api.getPurchases).mockRejectedValue(new Error('Network error 503'));
    vi.mocked(api.getSavingsSummary).mockRejectedValue(new Error('Network error 503'));

    render(
      <CurrencyProvider>
        <SavingsView profileId="prof-1" />
      </CurrencyProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Unable to Load Savings Journal')).toBeInTheDocument();
      expect(screen.getByText(/Network error 503/)).toBeInTheDocument();
    });

    // Verify retry button is present and clickable
    const retryBtn = screen.getByRole('button', { name: /Retry Connection/i });
    expect(retryBtn).toBeInTheDocument();

    // Re-resolve for retry
    vi.mocked(api.getPurchases).mockResolvedValue([]);
    vi.mocked(api.getSavingsSummary).mockResolvedValue({
      totalSpentEur: 0,
      totalSavedVsMsrpEur: 0,
      totalSavedVsMedianEur: 0,
      totalPurchases: 0,
      monthly: []
    });

    await act(async () => {
      fireEvent.click(retryBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('No purchases recorded yet')).toBeInTheDocument();
    });
  });

  it('deletes purchase when delete button is confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.getPurchases).mockResolvedValue(mockPurchases);
    vi.mocked(api.getSavingsSummary).mockResolvedValue(mockSummary);
    vi.mocked(api.deletePurchase).mockResolvedValue({ success: true } as any);

    render(
      <CurrencyProvider>
        <SavingsView profileId="prof-1" />
      </CurrencyProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('The Witcher 3')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole('button', { name: /Remove purchase from log/i });
    expect(deleteButtons.length).toBe(2);

    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    expect(api.deletePurchase).toHaveBeenCalledWith('pur-1');
  });
});
