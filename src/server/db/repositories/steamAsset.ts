import { prepareStmt } from '../core.js';

export interface SteamAssetRow {
  steam_app_id: number;
  asset_type: string;
  asset_url: string;
  local_path: string | null;
  last_updated_at: string;
}

export const steamAssetRepo = {
  get(steamAppId: number, assetType: string): string | undefined {
    const row = prepareStmt(`
      SELECT asset_url FROM steam_assets 
      WHERE steam_app_id = ? AND asset_type = ?
    `).get(steamAppId, assetType) as { asset_url: string } | undefined;
    return row?.asset_url;
  },

  upsert(steamAppId: number, assetType: string, assetUrl: string): void {
    const now = new Date().toISOString();
    prepareStmt(`
      INSERT INTO steam_assets (steam_app_id, asset_type, asset_url, last_updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(steam_app_id, asset_type) DO UPDATE SET
        asset_url = excluded.asset_url,
        last_updated_at = excluded.last_updated_at
    `).run(steamAppId, assetType, assetUrl, now);
  },

  getAll(steamAppId: number): Record<string, string> {
    const rows = prepareStmt(`
      SELECT asset_type, asset_url FROM steam_assets
      WHERE steam_app_id = ?
    `).all(steamAppId) as { asset_type: string; asset_url: string }[];
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.asset_type] = r.asset_url;
    }
    return result;
  }
};
