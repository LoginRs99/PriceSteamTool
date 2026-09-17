import { purgeCorruptedPrices } from '../src/server/db/cleanData.js';

console.log('--- PriceSteamTool Data Cleanup Utility ---');
const res = purgeCorruptedPrices();
console.log(`Successfully purged ${res.deletedOffers} corrupted offers (<= 0.05 EUR) and reset ${res.updatedGames} game records.`);
if (res.resolvedPricingErrors !== undefined) {
  console.log(`Resolved ${res.resolvedPricingErrors} false-positive pricing errors and unflagged ${res.unflaggedOffers} legitimate offers.`);
}
