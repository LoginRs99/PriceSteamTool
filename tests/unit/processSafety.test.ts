import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleShutdown, getIsShuttingDown, resetShuttingDownForTest } from '../../src/server/index.js';
import * as scheduler from '../../src/server/sync/scheduler.js';
import { syncOrchestrator } from '../../src/server/sync/orchestrator.js';
import * as dbModule from '../../src/server/db/index.js';

describe('Task 18: Process safety - exit on uncaughtException and idempotent shutdown', () => {
  let originalExit: typeof process.exit;
  let exitMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetShuttingDownForTest();
    process.exitCode = undefined;
    originalExit = process.exit;
    exitMock = vi.fn() as any;
    process.exit = exitMock as any;
  });

  afterEach(() => {
    process.exit = originalExit;
    process.exitCode = undefined;
    resetShuttingDownForTest();
    vi.restoreAllMocks();
  });

  it('isShuttingDown guard makes handleShutdown idempotent', async () => {
    const stopSchedulerSpy = vi.spyOn(scheduler, 'stopAutoSyncScheduler').mockImplementation(() => {});
    const cancelSyncSpy = vi.spyOn(syncOrchestrator, 'cancelSync').mockImplementation(() => {});
    const closeDbSpy = vi.spyOn(dbModule, 'closeDb').mockImplementation(() => {});
    const mockApp = { close: vi.fn().mockResolvedValue(undefined), log: { info: vi.fn() } } as any;

    expect(getIsShuttingDown()).toBe(false);

    // First invocation
    await handleShutdown('SIGINT', mockApp);
    expect(getIsShuttingDown()).toBe(true);
    expect(stopSchedulerSpy).toHaveBeenCalledTimes(1);
    expect(cancelSyncSpy).toHaveBeenCalledTimes(1);
    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(closeDbSpy).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledWith(0);

    // Second invocation: idempotent guard prevents re-executing
    await handleShutdown('SIGINT', mockApp);
    expect(stopSchedulerSpy).toHaveBeenCalledTimes(1);
    expect(cancelSyncSpy).toHaveBeenCalledTimes(1);
    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(closeDbSpy).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledTimes(1);
  });

  it('exits with code 1 when process.exitCode was set by uncaughtException', async () => {
    vi.spyOn(scheduler, 'stopAutoSyncScheduler').mockImplementation(() => {});
    vi.spyOn(syncOrchestrator, 'cancelSync').mockImplementation(() => {});
    vi.spyOn(dbModule, 'closeDb').mockImplementation(() => {});
    const mockApp = { close: vi.fn().mockResolvedValue(undefined), log: { info: vi.fn() } } as any;

    process.exitCode = 1;
    await handleShutdown('uncaughtException', mockApp);

    expect(getIsShuttingDown()).toBe(true);
    expect(exitMock).toHaveBeenCalledWith(1);
  });
});
