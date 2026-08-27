import type { Game, Offer, PriceHistoryEntry } from '../../../shared/types.js';

export interface PriceIntelligenceInput {
  game: Game;
  offers: Offer[];
  history: PriceHistoryEntry[];
}
