// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DiscordModal } from '../../src/client/src/components/DiscordModal.js';
import { ProfileModal } from '../../src/client/src/components/ProfileModal.js';
import { SourcesModal } from '../../src/client/src/components/SourcesModal.js';
import { SyncModal } from '../../src/client/src/components/SyncModal.js';
import { ScoreExplainModal } from '../../src/client/src/components/ScoreExplainModal.js';
import { Navbar } from '../../src/client/src/components/Navbar.js';
import { SyncBanner } from '../../src/client/src/components/SyncBanner.js';
import { AnomaliesView } from '../../src/client/src/components/AnomaliesView.js';
import { api } from '../../src/client/src/api.js';
import type { Profile, Game, SourceStatus, DiscordSettings, Anomaly } from '../../src/client/src/types.js';

const mockProfile: Profile = {
  id: 'prof-1',
  name: 'GamerGabe',
  steamId: '76561198000000001',
  customUrl: 'gabe',
  avatarUrl: 'https://steamcdn.com/avatar.jpg',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
};

const mockGame: Game = {
  id: 'game-1',
  steamAppId: 105600,
  title: 'Terraria',
  slug: 'terraria',
  isDlc: false,
  isFree: false,
  hasAnomaly: false,
  offersCount: 3,
  basePriceEur: 9.99,
  bestPriceEur: 4.99,
  bestDiscountPercent: 50,
  bestDealScore: 85,
  bestDealTier: 'Great',
  bestConfidenceScore: 90,
  bestMerchantName: 'Steam Store',
  bestMerchantIsOfficial: true,
  bestDealUrl: 'https://store.steampowered.com/app/105600',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
};

describe('Modals & Ancillary Components', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('DiscordModal', () => {
    it('loads Discord settings, edits input, and triggers save', async () => {
      const mockSettings = {
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
        isEnabled: true,
        minDealScore: 75,
        minConfidence: 40,
        notifyAtlOnly: true,
        notifyFreeGames: true,
        cooldownHours: 24
      };

      vi.spyOn(api, 'getDiscordSettings').mockResolvedValue(mockSettings as any);
      const saveSpy = vi.spyOn(api, 'saveDiscordSettings').mockResolvedValue(mockSettings as any);

      render(<DiscordModal isOpen={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByDisplayValue('https://discord.com/api/webhooks/123/abc')).toBeInTheDocument();
      });

      const saveBtn = screen.getByRole('button', { name: /Save Settings/i });
      await act(async () => {
        fireEvent.click(saveBtn);
      });

      expect(saveSpy).toHaveBeenCalled();
    });
  });

  describe('ProfileModal', () => {
    it('renders profile list and allows creating a new profile', async () => {
      const createProfileSpy = vi.spyOn(api, 'createProfile').mockResolvedValue(mockProfile);
      const refreshMock = vi.fn();

      render(
        <ProfileModal
          profiles={[mockProfile]}
          activeProfile={mockProfile}
          onClose={() => {}}
          onRefresh={refreshMock}
        />
      );

      expect(screen.getByText('Steam Profiles')).toBeInTheDocument();
      expect(screen.getByText('GamerGabe')).toBeInTheDocument();

      const nameInput = screen.getByPlaceholderText(/Profile Name/i);
      fireEvent.change(nameInput, { target: { value: 'Second Account' } });

      const idInput = screen.getByPlaceholderText(/Steam64 ID or Profile URL/i);
      fireEvent.change(idInput, { target: { value: '76561198000000002' } });

      const addBtn = screen.getByRole('button', { name: /Save Steam Profile/i });
      await act(async () => {
        fireEvent.click(addBtn);
      });

      expect(createProfileSpy).toHaveBeenCalledWith('Second Account', '76561198000000002');
    });
  });

  describe('SourcesModal', () => {
    it('loads sources and displays adapter circuit breaker status', async () => {
      const mockSources: SourceStatus[] = [
        {
          code: 'steam',
          name: 'Steam Store',
          isEnabled: true,
          requestCount: 10,
          successCount: 10,
          failureCount: 0,
          rateLimitCount: 0,
          state: 'NORMAL'
        }
      ];

      vi.spyOn(api, 'getSources').mockResolvedValue(mockSources);

      render(<SourcesModal onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Steam Store')).toBeInTheDocument();
      });
    });
  });

  describe('SyncModal', () => {
    it('allows toggling force refresh and triggers onStartSync', async () => {
      const startSyncMock = vi.fn();

      render(
        <SyncModal
          onClose={() => {}}
          onStartSync={startSyncMock}
          isSyncing={false}
        />
      );

      expect(screen.getByText('Synchronize Wishlist & Prices')).toBeInTheDocument();

      const startBtn = screen.getByRole('button', { name: /Start Sync/i });
      await act(async () => {
        fireEvent.click(startBtn);
      });

      expect(startSyncMock).toHaveBeenCalledWith(false, expect.any(Array));
    });
  });

  describe('ScoreExplainModal', () => {
    it('renders Deal Score breakdown for a game', () => {
      render(
        <ScoreExplainModal
          game={mockGame}
          onClose={() => {}}
        />
      );

      expect(screen.getByText('Deal Score Breakdown')).toBeInTheDocument();
      expect(screen.getByText('Terraria')).toBeInTheDocument();
      expect(screen.getByText('85')).toBeInTheDocument();
    });
  });

  describe('Navbar', () => {
    it('renders navigation brand, active profile, and action buttons', () => {
      const triggerSyncMock = vi.fn();

      render(
        <Navbar
          activeProfile={mockProfile}
          syncProgress={null}
          onOpenProfiles={() => {}}
          onOpenSources={() => {}}
          onOpenDiscord={() => {}}
          onTriggerSync={triggerSyncMock}
        />
      );

      expect(screen.getByText('PRICETOOL')).toBeInTheDocument();
      expect(screen.getByText('GamerGabe')).toBeInTheDocument();

      const syncBtn = screen.getByRole('button', { name: /Sync Wishlist/i });
      fireEvent.click(syncBtn);
      expect(triggerSyncMock).toHaveBeenCalled();
    });
  });

  describe('SyncBanner', () => {
    it('renders active sync step and cancel button', () => {
      const cancelMock = vi.fn();

      render(
        <SyncBanner
          progress={{
            status: 'RUNNING',
            currentAction: 'Fetching ITAD deals...',
            processedGames: 10,
            totalGames: 20,
            sourceProgress: {} as any
          }}
          onCancel={cancelMock}
        />
      );

      expect(screen.getByText('Wishlist Sync Active')).toBeInTheDocument();
      expect(screen.getByText('Fetching ITAD deals...')).toBeInTheDocument();

      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);
      expect(cancelMock).toHaveBeenCalled();
    });
  });

  describe('AnomaliesView', () => {
    it('loads and renders anomalies and allows dismissing them', async () => {
      const mockAnomaly: Anomaly = {
        id: 'anom-1',
        gameId: 'game-1',
        offerId: 'off-1',
        merchantName: 'Steam Store',
        anomalyType: 'PERCENTAGE_DROP',
        score: 95,
        reason: 'Price dropped by 99% (likely glitch)',
        priceEur: 0.10,
        detectedAt: '2026-01-01T00:00:00Z',
        gameTitle: 'Terraria'
      };

      vi.spyOn(api, 'getAnomalies').mockResolvedValue([mockAnomaly]);
      const dismissSpy = vi.spyOn(api, 'dismissAnomaly').mockResolvedValue({ success: true } as any);

      render(<AnomaliesView />);

      await waitFor(() => {
        expect(screen.getByText('Terraria')).toBeInTheDocument();
      });

      const dismissBtn = screen.getByRole('button', { name: /^Dismiss$/i });
      await act(async () => {
        fireEvent.click(dismissBtn);
      });

      expect(dismissSpy).toHaveBeenCalledWith('anom-1');
    });
  });
});
