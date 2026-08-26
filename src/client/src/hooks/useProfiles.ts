import { useState, useCallback, useEffect } from 'react';
import type { Profile } from '../types.js';
import { api } from '../api.js';

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [loadingProfiles, setLoadingProfiles] = useState(true);

  const loadProfiles = useCallback(async () => {
    try {
      const list = await api.getProfiles();
      setProfiles(list);
      const active = list.find(p => p.isActive) || (list.length > 0 ? list[0] : null);
      setActiveProfile(active);
      return active;
    } catch (e) {
      console.error('Failed to load profiles:', e);
      return null;
    } finally {
      setLoadingProfiles(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  return {
    profiles,
    activeProfile,
    setActiveProfile,
    loadingProfiles,
    loadProfiles
  };
}
