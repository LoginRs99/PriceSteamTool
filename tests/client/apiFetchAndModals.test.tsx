// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';
import { api, apiFetch } from '../../src/client/src/api.js';
import { ProfileModal } from '../../src/client/src/components/ProfileModal.js';
import { SourcesModal } from '../../src/client/src/components/SourcesModal.js';
import { DiscordModal } from '../../src/client/src/components/DiscordModal.js';
import { useWishlistSync } from '../../src/client/src/hooks/useWishlistSync.js';
import type { Profile, SourceStatus, DiscordSettings } from '../../src/client/src/types.js';

describe('Task 12: apiFetch, typed DiscordSettings, error handling in modals', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('apiFetch helper', () => {
    it('returns parsed json on ok response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ message: 'success' })),
      } as any);

      const result = await apiFetch<{ message: string }>('/api/test');
      expect(result).toEqual({ message: 'success' });
    });

    it('returns undefined on 204 No Content', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      } as any);

      const result = await apiFetch<void>('/api/test');
      expect(result).toBeUndefined();
    });

    it('throws custom error when body has error property on !res.ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Profile name required' }),
      } as any);

      await expect(apiFetch('/api/test')).rejects.toThrow('Profile name required');
    });

    it('throws Request failed (HTTP 401) when body has no error property', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      } as any);

      await expect(apiFetch('/api/test')).rejects.toThrow('Request failed (HTTP 401)');
    });

    it('throws Request failed (HTTP 502) when body is not JSON', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('SyntaxError')),
      } as any);

      await expect(apiFetch('/api/test')).rejects.toThrow('Request failed (HTTP 502)');
    });
  });

  describe('api methods use apiFetch and handle errors', () => {
    it('getProfiles throws when server returns 401/500', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' }),
      } as any);

      await expect(api.getProfiles()).rejects.toThrow('Unauthorized');
    });

    it('getWishlistGames throws when server returns error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Database locked' }),
      } as any);

      await expect(api.getWishlistGames()).rejects.toThrow('Database locked');
    });

    it('getAnomalies swallows errors and returns empty array', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Failed' }),
      } as any);

      const res = await api.getAnomalies();
      expect(res).toEqual([]);
    });

    it('getDiscordSettings returns typed settings with minConfidence and notifyPricingErrors', async () => {
      const mockSettings: DiscordSettings = {
        webhookUrl: 'https://discord.com/api/webhooks/1/2',
        isEnabled: true,
        minDealScore: 80,
        minConfidence: 60,
        notifyAtlOnly: true,
        notifyFreeGames: false,
        notifyPricingErrors: true,
        cooldownHours: 12,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockSettings)),
      } as any);

      const res = await api.getDiscordSettings();
      expect(res).toEqual(mockSettings);
      expect(res.minConfidence).toBe(60);
      expect(res.notifyPricingErrors).toBe(true);
    });
  });

  describe('ProfileModal error handling', () => {
    const mockProfile: Profile = {
      id: 'p-1',
      name: 'Tester',
      steamId: '76561198000000001',
      isActive: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    it('displays inline error and console.errors on handleSetActive failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(api, 'setActiveProfile').mockRejectedValue(new Error('Profile activation failed'));

      render(
        <ProfileModal
          profiles={[mockProfile]}
          activeProfile={null}
          onClose={() => {}}
          onRefresh={() => {}}
        />
      );

      const switchBtn = screen.getByRole('button', { name: /Select/i });
      await act(async () => {
        fireEvent.click(switchBtn);
      });

      await waitFor(() => {
        expect(screen.getByText('Profile activation failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith('Failed to set active profile:', expect.any(Error));
    });

    it('displays inline error and console.errors on handleDelete failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.spyOn(api, 'deleteProfile').mockRejectedValue(new Error('Profile deletion failed'));

      render(
        <ProfileModal
          profiles={[mockProfile]}
          activeProfile={null}
          onClose={() => {}}
          onRefresh={() => {}}
        />
      );

      const deleteBtn = screen.getByTitle('Delete profile');
      await act(async () => {
        fireEvent.click(deleteBtn);
      });

      await waitFor(() => {
        expect(screen.getByText('Profile deletion failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith('Failed to delete profile:', expect.any(Error));
    });
  });

  describe('SourcesModal error handling', () => {
    const mockSource: SourceStatus = {
      code: 'steam',
      name: 'Steam Store',
      isEnabled: true,
      requestCount: 1,
      successCount: 1,
      failureCount: 0,
      rateLimitCount: 0,
      state: 'NORMAL',
    };

    it('catches error and displays inline alert on handleToggle failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(api, 'getSources').mockResolvedValue([mockSource]);
      vi.spyOn(api, 'toggleSource').mockRejectedValue(new Error('Cannot toggle source in current state'));

      render(<SourcesModal onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Steam Store')).toBeInTheDocument();
      });

      const checkbox = screen.getByRole('checkbox');
      await act(async () => {
        fireEvent.click(checkbox);
      });

      await waitFor(() => {
        expect(screen.getByText('Cannot toggle source in current state')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith('Failed to toggle source:', expect.any(Error));
    });
  });

  describe('handleCancelSync wrapping', () => {
    it('catches and logs error when cancelSync fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(api, 'cancelSync').mockRejectedValue(new Error('Sync cancellation error'));

      const { result } = renderHook(() => useWishlistSync());

      await act(async () => {
        await result.current.handleCancelSync();
      });

      expect(consoleSpy).toHaveBeenCalledWith('Failed to cancel sync:', expect.any(Error));
    });
  });
});