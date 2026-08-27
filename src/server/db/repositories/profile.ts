import { randomUUID } from 'crypto';
import { getDb, prepareStmt } from '../core.js';
import type { Profile } from '../../../shared/types.js';

export const profileRepo = {
  list(): Profile[] {
    const rows = prepareStmt(`
      SELECT p.*, COUNT(w.id) as gameCount 
      FROM profiles p 
      LEFT JOIN wishlist_entries w ON p.id = w.profile_id AND w.is_active = 1
      GROUP BY p.id
      ORDER BY p.is_active DESC, p.created_at ASC
    `).all() as any[];

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      steamId: r.steam_id,
      customUrl: r.custom_url || undefined,
      avatarUrl: r.avatar_url || undefined,
      isActive: Boolean(r.is_active),
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
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  },

  create(name: string, steamId: string, customUrl?: string, avatarUrl?: string): Profile {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    const count = (prepareStmt(`SELECT COUNT(*) as count FROM profiles`).get() as any).count;
    const isActive = count === 0 ? 1 : 0;

    prepareStmt(`
      INSERT INTO profiles (id, name, steam_id, custom_url, avatar_url, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, steamId, customUrl || null, avatarUrl || null, isActive, now, now);

    return { id, name, steamId, customUrl, avatarUrl, isActive: Boolean(isActive), createdAt: now, updatedAt: now };
  },

  setActive(id: string): void {
    const db = getDb();
    const tx = db.transaction(() => {
      prepareStmt(`UPDATE profiles SET is_active = 0`).run();
      prepareStmt(`UPDATE profiles SET is_active = 1 WHERE id = ?`).run(id);
    });
    tx();
  },

  update(id: string, name: string, steamId: string, customUrl?: string, avatarUrl?: string): void {
    const now = new Date().toISOString();
    prepareStmt(`
      UPDATE profiles 
      SET name = ?, steam_id = ?, custom_url = ?, avatar_url = ?, updated_at = ?
      WHERE id = ?
    `).run(name, steamId, customUrl || null, avatarUrl || null, now, id);
  },

  delete(id: string): void {
    prepareStmt(`DELETE FROM profiles WHERE id = ?`).run(id);
  }
};
