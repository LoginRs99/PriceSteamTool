import { useState, useCallback, useEffect } from 'react';
import type { Anomaly } from '../types.js';
import { api } from '../api.js';

export function useAnomalies() {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);

  const loadAnomalies = useCallback(async () => {
    try {
      const list = await api.getAnomalies();
      setAnomalies(list || []);
    } catch (e) {
      console.error('Failed to load anomalies:', e);
    }
  }, []);

  useEffect(() => {
    loadAnomalies();
  }, [loadAnomalies]);

  return {
    anomalies,
    loadAnomalies
  };
}
