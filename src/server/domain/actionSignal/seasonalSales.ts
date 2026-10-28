/**
 * Known Steam Major Seasonal Sales approximate calendar dates and typical durations
 */
export const STEAM_SEASONAL_SALES = [
  { name: 'Steam Spring Sale', month: 2, day: 14, durationDays: 7 },     // March ~14 (7 days)
  { name: 'Steam Summer Sale', month: 5, day: 25, durationDays: 14 },    // June ~25 (14 days)
  { name: 'Steam Autumn Sale', month: 10, day: 25, durationDays: 7 },    // November ~25 (7 days)
  { name: 'Steam Winter Sale', month: 11, day: 18, durationDays: 14 }    // December ~18 (14 days)
];

/**
 * Checks if a major Steam Seasonal Sale is approaching or currently active
 */
export function getUpcomingSteamSale(now: Date = new Date()): { 
  name: string; 
  daysUntil: number; 
  isImminent: boolean;
  isOngoing?: boolean;
} | null {
  const nowMs = now.getTime();
  const currentYear = now.getFullYear();

  // 1. Check if a major seasonal sale is currently active right now
  for (const year of [currentYear - 1, currentYear]) {
    for (const sale of STEAM_SEASONAL_SALES) {
      const startDate = new Date(year, sale.month, sale.day);
      const startMs = startDate.getTime();
      const endMs = startMs + (sale.durationDays || 7) * 24 * 60 * 60 * 1000;
      if (nowMs >= startMs && nowMs <= endMs) {
        return {
          name: sale.name,
          daysUntil: 0,
          isImminent: true,
          isOngoing: true
        };
      }
    }
  }

  // 2. Otherwise find the closest upcoming future sale
  let closestEvent: { name: string; targetDate: Date; daysUntil: number } | null = null;
  for (const year of [currentYear, currentYear + 1]) {
    for (const sale of STEAM_SEASONAL_SALES) {
      const targetDate = new Date(year, sale.month, sale.day);
      const diffMs = targetDate.getTime() - nowMs;
      const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (daysUntil > 0) {
        if (!closestEvent || daysUntil < closestEvent.daysUntil) {
          closestEvent = { name: sale.name, targetDate, daysUntil };
        }
      }
    }
  }

  if (!closestEvent) return null;

  return {
    name: closestEvent.name,
    daysUntil: closestEvent.daysUntil,
    isImminent: closestEvent.daysUntil <= 14,
    isOngoing: false
  };
}
