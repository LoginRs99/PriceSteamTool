import { randomUUID } from 'crypto';
import { getDb, prepareStmt } from '../core.js';
import type { Profile } from '../../../shared/types.js';

export const profileRepo = {
  list(): Profile[] {
    const rows = prepareStmt(`
      SELECT p.*, 
        COUNT(DISTINCT w.id) as gameCount,
        (SELECT COUNT(*) FROM family_owned_apps fo WHERE fo.profile_id = p.id) as familyGamesCount
      FROM profiles p 
      LEFT JOIN wishlist_entries w ON p.id = w.profile_id AND w.is_active = 1
      GROUP BY p.id
      ORDER BY p.is_active DESC, p.is_family DESC, p.created_at ASC
    `).all() as any[];

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      steamId: r.steam_id,
      customUrl: r.custom_url || undefined,
      avatarUrl: r.avatar_url || undefined,
      isActive: Boolean(r.is_active),
      isFamily: Boolean(r.is_family),
      familyGamesCount: Number(r.familyGamesCount || 0),
      gameCount: Number(r.gameCount || 0),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  },

  getActive(): Profile | null {
    const row = prepareStmt(`SELECT * FROM profiles WHERE is_active = 1 LIMIT 1`).get() as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      steamId: row.steam_id,
      customUrl: row.custom_url || undefined,
      avatarUrl: row.avatar_url || undefined,
      isActive: true,
      isFamily: Boolean(row.is_family),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  getById(id: string): Profile | null {
    const row = prepareStmt(`SELECT * FROM profiles WHERE id = ?`).get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      steamId: row.steam_id,
      customUrl: row.custom_url || undefined,
      avatarUrl: row.avatar_url || undefined,
      isActive: Boolean(row.is_active),
      isFamily: Boolean(row.is_family),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  getBySteamId(steamId: string): Profile | null {
    const row = prepareStmt(`SELECT * FROM profiles WHERE steam_id = ?`).get(steamId) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      steamId: row.steam_id,
      customUrl: row.custom_url || undefined,
      avatarUrl: row.avatar_url || undefined,
      isActive: Boolean(row.is_active),
      isFamily: Boolean(row.is_family),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  create(name: string, steamId: string, customUrl?: string, avatarUrl?: string, isFamily: boolean = false): Profile {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    const count = (prepareStmt(`SELECT COUNT(*) as count FROM profiles`).get() as any).count;
    const isActive = count === 0 ? 1 : 0;

    prepareStmt(`
      INSERT INTO profiles (id, name, steam_id, custom_url, avatar_url, is_active, is_family, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, steamId, customUrl || null, avatarUrl || null, isActive, isFamily ? 1 : 0, now, now);

    return { 
      id, 
      name, 
      steamId, 
      customUrl, 
      avatarUrl, 
      isActive: Boolean(isActive), 
      isFamily, 
      createdAt: now, 
      updatedAt: now 
    };
  },

  setActive(id: string): void {
    const db = getDb();
    const tx = db.transaction(() => {
      prepareStmt(`UPDATE profiles SET is_active = 0`).run();
      prepareStmt(`UPDATE profiles SET is_active = 1 WHERE id = ?`).run(id);
    });
    tx();
  },

  setFamily(id: string, isFamily: boolean): void {
    prepareStmt(`UPDATE profiles SET is_family = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(isFamily ? 1 : 0, id);
  },

  saveFamilyOwnedApps(profileId: string, appIds: number[]): void {
    const db = getDb();
    const now = new Date().toISOString();
    const deleteStmt = prepareStmt(`DELETE FROM family_owned_apps WHERE profile_id = ?`);
    const insertStmt = prepareStmt(`
      INSERT OR REPLACE INTO family_owned_apps (profile_id, steam_app_id, synced_at)
      VALUES (?, ?, ?)
    `);

    const tx = db.transaction(() => {
      deleteStmt.run(profileId);
      for (const appId of appIds) {
        insertStmt.run(profileId, appId, now);
      }
    });
    tx();
  },

  getFamilyOwnedAppIds(): Set<number> {
    const rows = prepareStmt(`
      SELECT DISTINCT fo.steam_app_id 
      FROM family_owned_apps fo
      JOIN profiles p ON fo.profile_id = p.id
      WHERE p.is_family = 1
    `).all() as { steam_app_id: number }[];
    return new Set(rows.map(r => Number(r.steam_app_id)));
  },

  update(id: string, name: string, steamId: string, customUrl?: string, avatarUrl?: string, isFamily?: boolean): void {
    const now = new Date().toISOString();
    prepareStmt(`
      UPDATE profiles 
      SET name = ?, steam_id = ?, custom_url = ?, avatar_url = ?, 
          is_family = CASE WHEN ? IS NOT NULL THEN ? ELSE is_family END,
          updated_at = ?
      WHERE id = ?
    `).run(
      name, 
      steamId, 
      customUrl || null, 
      avatarUrl || null, 
      isFamily !== undefined ? (isFamily ? 1 : 0) : null,
      isFamily !== undefined ? (isFamily ? 1 : 0) : null,
      now, 
      id
    );
  },

  delete(id: string): void {
    prepareStmt(`DELETE FROM profiles WHERE id = ?`).run(id);
  }
};
