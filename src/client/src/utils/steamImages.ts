/**
 * Steam Store Image Resolution Utility
 * 
 * Provides robust, high-availability image resolution using Valve's official
 * Cloudflare CDN infrastructure with graceful progressive fallback stages.
 */

export function getSteamHeaderUrl(appId: number): string {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
}

export function getSteamCapsuleUrl(appId: number, size: 'large' | 'medium' | 'small' = 'medium'): string {
  if (size === 'large') {
    return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`;
  }
  if (size === 'small') {
    return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_sm_120.jpg`;
  }
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_231x87.jpg`;
}

export function getGameCoverCandidates(game: {
  steamAppId: number;
  headerImage?: string;
  capsuleImage?: string;
}): string[] {
  const appId = game.steamAppId;
  const urls: string[] = [];

  // 1. High-resolution Storefront header image (clean URL preferred)
  if (game.headerImage && !game.headerImage.includes('capsule_sm_120') && !game.headerImage.includes('cdn.akamai.')) {
    urls.push(game.headerImage);
  }

  // 2. Official Cloudflare primary store header (460x215)
  if (appId > 0) {
    urls.push(`https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`);
    // 3. Large capsule banner (616x353)
    urls.push(`https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_616x353.jpg`);
    // 4. Medium capsule (231x87)
    urls.push(`https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_231x87.jpg`);
  }

  // 5. Existing capsuleImage if valid and not already added
  if (game.capsuleImage && !urls.includes(game.capsuleImage)) {
    urls.push(game.capsuleImage);
  }

  // 6. Legacy Akamai fallback (some very old catalog titles)
  if (appId > 0) {
    urls.push(`https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`);
  }

  return urls;
}
