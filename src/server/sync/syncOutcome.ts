import type { SourceCode } from '../../shared/types.js';

export type CoreSyncStatus = 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED';

export function calculateCoreSyncStatus(
  activeCoreSources: SourceCode[],
  sourceOutcomes: Map<SourceCode, 'SUCCESS' | 'FAILED'>
): { status: CoreSyncStatus; failedSources: SourceCode[] } {
  const successfulSources = activeCoreSources.filter(c => sourceOutcomes.get(c) === 'SUCCESS');
  const failedSources = activeCoreSources.filter(c => sourceOutcomes.get(c) === 'FAILED');

  let status: CoreSyncStatus = 'COMPLETED';
  if (activeCoreSources.length > 0 && successfulSources.length === 0 && failedSources.length > 0) {
    status = 'FAILED';
  } else if (activeCoreSources.length > 0 && failedSources.length > 0) {
    status = 'COMPLETED_WITH_WARNINGS';
  }

  return { status, failedSources };
}
