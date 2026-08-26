// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameCard } from '../../src/client/src/components/GameCard.js';
import type { Game } from '../../src/client/src/types.js';

const mockGameBase: Game = {
  id: 'game-1',
  steamAppId: 1091500,
  title: 'Cyberpunk 2077',
  slug: 'cyberpunk-2077',
  isDlc: false,
  isFree: false,
  hasAnomaly: false,
  offersCount: 1,
  basePriceEur: 59.99,
  bestPriceEur: 29.99,
  bestDiscountPercent: 50,
  bestDealScore: 85,
  bestDealTier: 'Great',
  bestConfidenceScore: 90,
  bestMerchantName: 'Steam Store',
  bestMerchantIsOfficial: true,
  bestDealUrl: 'https://store.steampowered.com/app/1091500',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
};

describe('GameCard Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders game title, price, discount badge and deal score', () => {
    const handleClick = vi.fn();
    render(<GameCard game={mockGameBase} onClick={handleClick} />);

    expect(screen.getByRole('heading', { name: 'Cyberpunk 2077' })).toBeInTheDocument();
    expect(screen.getByText('-50%')).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('Great')).toBeInTheDocument();
    expect(screen.getByText('€29.99')).toBeInTheDocument();
    expect(screen.getByText('€59.99')).toBeInTheDocument();
    expect(screen.getByText('Steam Store')).toBeInTheDocument();
  });

  it('triggers onClick when the game card is clicked', async () => {
    const handleClick = vi.fn();
    render(<GameCard game={mockGameBase} onClick={handleClick} />);

    const card = screen.getByRole('heading', { name: 'Cyberpunk 2077' }).closest('.game-card');
    expect(card).toBeInTheDocument();
    fireEvent.click(card!);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders FREE label when isFree is true or bestPriceEur is 0', () => {
    const freeGame: Game = {
      ...mockGameBase,
      isFree: true,
      bestPriceEur: 0,
      bestDiscountPercent: 100
    };
    render(<GameCard game={freeGame} onClick={() => {}} />);

    expect(screen.getByText('FREE')).toBeInTheDocument();
  });

  it('renders ATL badge when deal is confirmed All-Time Low and not provisional', () => {
    const atlGame: Game = {
      ...mockGameBase,
      bestPriceEvent: 'NEW_HISTORICAL_LOW',
      bestIsProvisional: false
    };
    render(<GameCard game={atlGame} onClick={() => {}} />);

    expect(screen.getByText('ATL')).toBeInTheDocument();
    expect(screen.getByText('★ Matches All-Time Low')).toBeInTheDocument();
  });

  it('renders target price HIT and PENDING badges appropriately', () => {
    // Target HIT (bestPriceEur <= targetPriceEur)
    const hitGame: Game = {
      ...mockGameBase,
      bestPriceEur: 19.99,
      targetPriceEur: 20.00
    };
    const { rerender } = render(<GameCard game={hitGame} onClick={() => {}} />);
    expect(screen.getByText('🎯 HIT')).toBeInTheDocument();

    // Target PENDING (bestPriceEur > targetPriceEur)
    const pendingGame: Game = {
      ...mockGameBase,
      bestPriceEur: 35.00,
      targetPriceEur: 20.00
    };
    rerender(<GameCard game={pendingGame} onClick={() => {}} />);
    expect(screen.getByText('🎯 €20.00')).toBeInTheDocument();
  });

  it('renders action signal pill with reason when actionSignal is present', () => {
    const signalGame: Game = {
      ...mockGameBase,
      actionSignal: {
        decision: 'STRONG_BUY',
        badgeLabel: 'Must Buy',
        badgeColor: '#10b981',
        primaryReason: 'At historical low with 50% discount',
        urgency: 'HIGH',
        timingContext: 'Major seasonal sale'
      }
    };
    render(<GameCard game={signalGame} onClick={() => {}} />);

    expect(screen.getByText('Must Buy')).toBeInTheDocument();
  });

  it('renders risk flag and suppresses action signal when game has high risk or anomaly', () => {
    const riskyGame: Game = {
      ...mockGameBase,
      hasAnomaly: true,
      bestRiskLevel: 'HIGH',
      actionSignal: {
        decision: 'BUY',
        badgeLabel: 'Buy',
        badgeColor: '#3b82f6',
        primaryReason: 'Good deal',
        urgency: 'LOW',
        timingContext: 'Standard promo'
      }
    };
    render(<GameCard game={riskyGame} onClick={() => {}} />);

    expect(screen.getByText('Risk Flag')).toBeInTheDocument();
    expect(screen.queryByText('Buy')).not.toBeInTheDocument();
  });

  it('calls onExplain when info button or score badge is clicked without triggering card onClick', () => {
    const handleCardClick = vi.fn();
    const handleExplain = vi.fn();
    render(<GameCard game={mockGameBase} onClick={handleCardClick} onExplain={handleExplain} />);

    const explainBtn = screen.getByLabelText('Explain deal score for Cyberpunk 2077');
    fireEvent.click(explainBtn);

    expect(handleExplain).toHaveBeenCalledWith(mockGameBase);
    expect(handleCardClick).not.toHaveBeenCalled();
  });

  it('copies Steam URL to clipboard when copy button is clicked', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock
      }
    });

    render(<GameCard game={mockGameBase} onClick={() => {}} />);

    const copyBtn = screen.getByLabelText('Copy Steam store link for Cyberpunk 2077');
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeTextMock).toHaveBeenCalledWith('https://store.steampowered.com/app/1091500/');
  });

  it('renders savings vs typical median price in context line', () => {
    const savingsGame: Game = {
      ...mockGameBase,
      bestSavingVsMedianEur: 15.00,
      typicalSaleMedianEur: 44.99
    };
    render(<GameCard game={savingsGame} onClick={() => {}} />);

    expect(screen.getByText('€15.00 below typical (€44.99)')).toBeInTheDocument();
  });
});
