// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { getSteamReviewSentiment } from '../../src/client/src/utils/steamMeta.js';
import { IntelMetricsGrid } from '../../src/client/src/components/detail/IntelMetricsGrid.js';
import { GameCard } from '../../src/client/src/components/GameCard.js';
import { DenseTableView } from '../../src/client/src/components/DenseTableView.js';
import { ScoreExplainModal } from '../../src/client/src/components/ScoreExplainModal.js';
import type { Game, PriceIntelligenceResponse } from '../../src/client/src/types.js';

describe('Task 16 UI Integrity', () => {
  describe('getSteamReviewSentiment', () => {
    it('maps percentages to Steam official sentiment tiers', () => {
      expect(getSteamReviewSentiment(95)).toBe('positive');
      expect(getSteamReviewSentiment(70)).toBe('positive');
      expect(getSteamReviewSentiment(69)).toBe('mixed');
      expect(getSteamReviewSentiment(40)).toBe('mixed');
      expect(getSteamReviewSentiment(39)).toBe('negative');
      expect(getSteamReviewSentiment(0)).toBe('negative');
      expect(getSteamReviewSentiment(null)).toBe('negative');
      expect(getSteamReviewSentiment(undefined)).toBe('negative');
    });
  });

  describe('IntelMetricsGrid undefined price handling', () => {
    it('renders em-dash instead of €undefined when medianPriceEur is undefined', () => {
      const intelWithoutMedian: PriceIntelligenceResponse = {
        typicalSale: {
          sampleCount: 0,
          // medianPriceEur is undefined
        } as any
      } as any;

      render(<IntelMetricsGrid intelligence={intelWithoutMedian} />);
      expect(screen.queryByText(/€undefined/)).not.toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('renders formatted price when medianPriceEur is defined', () => {
      const intelWithMedian: PriceIntelligenceResponse = {
        typicalSale: {
          medianPriceEur: 14.99,
          sampleCount: 5,
          q1PriceEur: 12.99,
          q3PriceEur: 16.99
        } as any
      } as any;

      render(<IntelMetricsGrid intelligence={intelWithMedian} />);
      expect(screen.getByText('€14.99')).toBeInTheDocument();
    });
  });

  describe('GameCard and DenseTableView glitch badges without fake 99', () => {
    const glitchGame: Game = {
      id: 'g-glitch',
      steamAppId: 12345,
      title: 'Glitch Game',
      slug: 'glitch-game',
      isDlc: false,
      isFree: false,
      hasAnomaly: false,
      offersCount: 1,
      basePriceEur: 69.99,
      bestPriceEur: 0.99,
      bestPriceEvent: 'PRICING_ERROR',
      bestDealScore: 20, // Real penalized score, NOT 99
      bestDealTier: "Fair",
      steamReviewPercent: 75,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    it('GameCard renders ⚡ alone without fake 99', () => {
      render(<GameCard game={glitchGame} onClick={() => {}} />);
      expect(screen.queryByText('⚡ 99')).not.toBeInTheDocument();
      expect(screen.getByText('⚡')).toBeInTheDocument();
    });

    it('DenseTableView renders ⚡ GLITCH without 99', () => {
      const { container } = render(<DenseTableView games={[glitchGame]} onGameClick={() => {}} />);
      expect(screen.queryByText(/⚡ GLITCH 99/)).not.toBeInTheDocument();
      const scoreChip = container.querySelector('.cell-score .score-chip-sm');
      expect(scoreChip).toHaveTextContent('⚡ GLITCH');
      expect(scoreChip).not.toHaveTextContent('99');
    });

    it('applies positive sentiment class to 75% review pill', () => {
      const { container } = render(<GameCard game={glitchGame} onClick={() => {}} />);
      const pill = container.querySelector('.steam-review-pill');
      expect(pill).toHaveClass('positive');
    });
  });

  describe('ScoreExplainModal copy alignment', () => {
    const provisionalGame: Game = {
      id: 'g-prov',
      steamAppId: 99999,
      title: 'Provisional Game',
      slug: 'provisional-game',
      isDlc: false,
      isFree: false,
      hasAnomaly: false,
      offersCount: 1,
      bestIsProvisional: true,
      bestDealScore: 65,
      bestDealTier: "Fair",
      typicalSaleSampleCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    it('renders updated provisional copy and disclaimer', () => {
      render(<ScoreExplainModal game={provisionalGame} onClose={() => {}} />);
      expect(screen.getByText(/capped at 65 — or 80 for deep discounts of 60%\+ off MSRP — until at least 3 historical datapoints exist/)).toBeInTheDocument();
      expect(screen.getByText(/Offers flagged as pricing anomalies receive a safety penalty; data confidence is reported separately and never inflates the score/)).toBeInTheDocument();
    });
  });
});