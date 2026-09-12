import { steamAssetRepo } from '../db/repositories/steamAsset.js';

export type SteamAssetType = 'header' | 'capsule' | 'icon';

export interface SteamAssetsResolved {
  headerUrl: string;
  capsuleUrl: string;
  iconUrl: string;
}

export function canonicalSteamAssetUrl(appId: number, type: SteamAssetType): string {
  const base = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}`;
  switch (type) {
    case 'header':
      return `${base}/header.jpg`;
    case 'capsule':
      return `${base}/capsule_231x87.jpg`;
    case 'icon':
      return `${base}/capsule_sm_120.jpg`;
  }
}

export function isValidAssetUrl(url?: string | null, type?: SteamAssetType): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) return false;

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const isSteamHost = 
      host.includes('steamstatic.com') ||
      host.includes('steamcdn') ||
      host.includes('steamcontent.com') ||
      host.includes('steampowered.com');
    if (!isSteamHost) return false;

    if (type === 'header' && trimmed.includes('capsule_sm_120')) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

interface CachedAssetEntry {
  assets: SteamAssetsResolved;
  cachedAt: number;
}

const assetCache = new Map<number, CachedAssetEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function resolveAndCacheSteamAssets(
  appId: number,
  provided?: { headerImage?: string | null; capsuleImage?: string | null; iconImage?: string | null }
): Promise<SteamAssetsResolved> {
  const now = Date.now();
  const cached = assetCache.get(appId);
  if (cached && (now - cached.cachedAt) < CACHE_TTL_MS) {
    return cached.assets;
  }

  // On miss: read DB via repo
  const fromDb = steamAssetRepo.getAll(appId);

  // Build each type from provided (if valid) else from DB (if valid) else canonical
  const headerUrl = isValidAssetUrl(provided?.headerImage, 'header')
    ? provided!.headerImage!.trim()
    : (isValidAssetUrl(fromDb['header'], 'header') ? fromDb['header'] : canonicalSteamAssetUrl(appId, 'header'));

  const capsuleUrl = isValidAssetUrl(provided?.capsuleImage, 'capsule')
    ? provided!.capsuleImage!.trim()
    : (isValidAssetUrl(fromDb['capsule'], 'capsule') ? fromDb['capsule'] : canonicalSteamAssetUrl(appId, 'capsule'));

  const iconUrl = isValidAssetUrl(provided?.iconImage, 'icon')
    ? provided!.iconImage!.trim()
    : (isValidAssetUrl(fromDb['icon'], 'icon') ? fromDb['icon'] : canonicalSteamAssetUrl(appId, 'icon'));

  // Upsert all three rows
  steamAssetRepo.upsert(appId, 'header', headerUrl);
  steamAssetRepo.upsert(appId, 'capsule', capsuleUrl);
  steamAssetRepo.upsert(appId, 'icon', iconUrl);

  const assets: SteamAssetsResolved = { headerUrl, capsuleUrl, iconUrl };
  assetCache.set(appId, { assets, cachedAt: now });

  return assets;
}

export function clearSteamAssetCache(): void {
  assetCache.clear();
}
