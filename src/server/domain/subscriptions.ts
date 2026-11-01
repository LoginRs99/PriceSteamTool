export type SubscriptionService = 'GAME_PASS' | 'EA_PLAY';

/**
 * Curated registry of known Steam App IDs included in PC Game Pass and EA Play.
 */
const GAME_PASS_APP_IDS = new Set<number>([
  // Xbox Game Studios & Bethesda
  976730,  // Halo: The Master Chief Collection
  1708091, // Halo Infinite (Campaign)
  1240440, // Halo Infinite (Free-to-Play/Core)
  1551360, // Forza Horizon 5
  1293830, // Forza Horizon 4
  2738450, // Forza Motorsport
  1172620, // Sea of Thieves
  1716740, // Starfield
  377160,  // Fallout 4
  1151340, // Fallout 76
  22380,   // Fallout: New Vegas
  22300,   // Fallout 3
  489830,  // The Elder Scrolls V: Skyrim Special Edition
  22330,   // The Elder Scrolls IV: Oblivion
  22320,   // The Elder Scrolls III: Morrowind
  782330,  // DOOM Eternal
  379720,  // DOOM (2016)
  3017860, // DOOM: The Dark Ages
  350080,  // Wolfenstein: The New Order
  612880,  // Wolfenstein II: The New Colossus
  205100,  // Dishonored
  403640,  // Dishonored 2
  1252330, // DEATHLOOP
  1817230, // Hi-Fi RUSH
  414340,  // Hellblade: Senua's Sacrifice
  2052410, // Senua's Saga: Hellblade II
  1466860, // Age of Empires IV
  813780,  // Age of Empires II: Definitive Edition
  962130,  // Grounded
  2457220, // Avowed
  2439770, // Clockwork Revolution

  // Atlus / SEGA
  2161700, // Persona 3 Reload
  1113000, // Persona 4 Golden
  1687950, // Persona 5 Royal
  2252570, // Persona 5 Tactica
  1809700, // Persona 3 Portable
  2620600, // Metaphor: ReFantazio
  1235140, // Yakuza: Like a Dragon
  2375550, // Like a Dragon Gaiden
  638970,  // Yakuza 0
  834530,  // Yakuza Kiwami
  927380,  // Yakuza Kiwami 2
  1089040, // Yakuza 3 Remastered
  1105500, // Yakuza 4 Remastered
  1105510, // Yakuza 5 Remastered
  1388590, // Yakuza 6: The Song of Life

  // Major Indies & Partners
  367520,  // Hollow Knight
  1030300, // Hollow Knight: Silksong
  1627720, // Lies of P
  1623730, // Palworld
  588650,  // Dead Cells
  646570,  // Slay the Spire
  504230,  // Celeste
  1145360, // Hades
  264710,  // Subnautica
  548430,  // Deep Rock Galactic
  1446780, // Monster Hunter Rise
  1363080, // Manor Lords
  1601580, // Frostpunk 2
  1282100, // Remnant II
  617290,  // Remnant: From the Ashes
  1497440, // COCOON
  553420,  // TUNIC
  1244090, // Sea of Stars
  1931770, // Chants of Sennaar
  1794680  // Vampire Survivors
]);

const EA_PLAY_APP_IDS = new Set<number>([
  1693980, // Dead Space Remake
  1172380, // STAR WARS Jedi: Fallen Order
  1774580, // STAR WARS Jedi: Survivor
  1328670, // Mass Effect Legendary Edition
  1238000, // Mass Effect: Andromeda
  1517290, // Battlefield 2042
  1238810, // Battlefield V
  1238840, // Battlefield 1
  1238860, // Battlefield 4
  1222690, // Dragon Age: Inquisition
  1238040, // Dragon Age II
  47810,   // Dragon Age: Origins
  1237970, // Titanfall 2
  1846380, // Need for Speed Unbound
  1222680, // Need for Speed Heat
  1426210, // It Takes Two
  1222700, // A Way Out
  1238080, // Burnout Paradise Remastered
  1233570, // Mirror's Edge Catalyst
  2108330, // F1 23
  2488620, // F1 24
  2195250, // EA SPORTS FC 24
  1222670  // The Sims 4
]);

/**
 * Returns active subscription services for a given Steam game
 */
export function getGameSubscriptions(steamAppId?: number, title?: string): SubscriptionService[] {
  if (!steamAppId) return [];
  const services: SubscriptionService[] = [];

  if (GAME_PASS_APP_IDS.has(steamAppId)) {
    services.push('GAME_PASS');
  }

  if (EA_PLAY_APP_IDS.has(steamAppId)) {
    services.push('EA_PLAY');
  }

  return services;
}
