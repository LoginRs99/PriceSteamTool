import type { PriceHistoryEntry } from '../../../shared/types.js';

export interface ActionSignalInput {
  dealScore: number;
  confidenceScore: number;
  isProvisional: boolean;
  isAnomaly: boolean;
  currentPriceEur: number;
  basePriceEur?: number;
  typicalSaleMedianEur?: number;
  typicalSaleQ1Eur?: number;
  typicalSaleQ3Eur?: number;
  typicalSaleSampleCount?: number;
  historicalLowEur?: number;
  low90dEur?: number;
  history?: PriceHistoryEntry[];
  currentDate?: Date;
}
