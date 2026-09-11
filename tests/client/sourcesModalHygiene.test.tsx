import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SourcesModal } from '../../src/client/src/components/SourcesModal.js';
import { api } from '../../src/client/src/api.js';
import type { SourceStatus } from '../../src/client/src/types.js';

describe('Task 21: SourcesModal polling hygiene & loading state', () => {
  const mockSources: SourceStatus[] = [
    {
      code: 'steam',
      name: 'Steam Store',
      isEnabled: true,
      requestCount: 5,
      successCount: 5,
      failureCount: 0,
      rateLimitCount: 0,
      state: 'NORMAL'
    }
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders loading state initially while sources are loading', async () => {
    let resolveSources: (val: SourceStatus[]) => void;
    const sourcesPromise = new Promise<SourceStatus[]>(resolve => {
      resolveSources = resolve;
    });
    vi.spyOn(api, 'getSources').mockReturnValue(sourcesPromise);

    render(<SourcesModal onClose={() => {}} />);

    expect(screen.getByText('Loading sources...')).toBeInTheDocument();

    await act(async () => {
      resolveSources!(mockSources);
    });

    await waitFor(() => {
      expect(screen.queryByText('Loading sources...')).not.toBeInTheDocument();
      expect(screen.getByText('Steam Store')).toBeInTheDocument();
    });
  });

  it('uses 5000ms interval for polling', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    vi.spyOn(api, 'getSources').mockResolvedValue(mockSources);

    render(<SourcesModal onClose={() => {}} />);

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it('skips polling fetch when document.hidden is true', async () => {
    vi.useFakeTimers();
    const getSourcesSpy = vi.spyOn(api, 'getSources').mockResolvedValue(mockSources);

    // Initial render with document visible
    render(<SourcesModal onClose={() => {}} />);

    // Initial fetch was called once
    expect(getSourcesSpy).toHaveBeenCalledTimes(1);

    // Simulate tab hidden
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true
    });

    // Advance by 5000ms
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    // Should NOT have fetched again
    expect(getSourcesSpy).toHaveBeenCalledTimes(1);

    // Restore document.hidden to false
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false
    });

    // Advance by another 5000ms
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    // Now it should have fetched
    expect(getSourcesSpy).toHaveBeenCalledTimes(2);
  });

  it('calls fetchSources in finally block when handleToggle throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const getSourcesSpy = vi.spyOn(api, 'getSources').mockResolvedValue(mockSources);
    const toggleSpy = vi.spyOn(api, 'toggleSource').mockRejectedValue(new Error('Toggle failed'));

    render(<SourcesModal onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Steam Store')).toBeInTheDocument();
    });

    expect(getSourcesSpy).toHaveBeenCalledTimes(1);

    const checkbox = screen.getByRole('checkbox');
    await act(async () => {
      fireEvent.click(checkbox);
    });

    await waitFor(() => {
      expect(screen.getByText('Toggle failed')).toBeInTheDocument();
    });

    // getSources should have been called again via finally block!
    expect(toggleSpy).toHaveBeenCalledWith('steam', false);
    expect(getSourcesSpy).toHaveBeenCalledTimes(2);
  });
});
