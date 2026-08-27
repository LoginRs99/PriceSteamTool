/**
 * Known Steam Major Seasonal Sales approximate calendar dates
 */
export const STEAM_SEASONAL_SALES = [
  { name: 'Steam Spring Sale', month: 2, day: 14 },     // March ~14
  { name: 'Steam Summer Sale', month: 5, day: 25 },     // June ~25
  { name: 'Steam Autumn Sale', month: 10, day: 25 },    // November ~25
  { name: 'Steam Winter Sale', month: 11, day: 18 }     // December ~18
];

/**
 * Checks if a major Steam Seasonal Sale is approaching within the next window of days
 */
export function getUpcomingSteamSale(now: Date = new Date()): { 
  name: string; 
  daysUntil: number; 
  isImminent: boolean 
} | null {
  const currentYear = now.getFullYear();
  let closestEvent: { name: string; targetDate: Date; daysUntil: number } | null = null;

  for (const year of [currentYear, currentYear + 1]) {
    for (const sale of STEAM_SEASONAL_SALES) {
      const targetDate = new Date(year, sale.month, sale.day);
      const diffMs = targetDate.getTime() - now.getTime();
      const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (daysUntil >= 0) {
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
    isImminent: closestEvent.daysUntil <= 14
  };
}
