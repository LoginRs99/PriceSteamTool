import { useEffect, useState, useRef } from 'react';
import type { Game, Offer, PriceHistoryEntry, PriceIntelligenceResponse } from '../../types.js';
import { api } from '../../api.js';
import { useCurrency } from '../../context/CurrencyContext.js';

export function useGameIntelligence(
  gameId: string,
  onClose: () => void,
  onTargetPriceUpdated?: (gameId: string, targetPriceEur: number | null) => void,
  onGameUpdated?: (gameId: string) => void
) {
  const { convertEurToLocal, convertLocalToEur, currencyInfo } = useCurrency();
  const [data, setData] = useState<{ 
    game: Game; 
    offers: Offer[]; 
    history: PriceHistoryEntry[];
    intelligence?: PriceIntelligenceResponse;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedVoucherId, setCopiedVoucherId] = useState<string | null>(null);
  const [targetPriceInput, setTargetPriceInput] = useState<string>('');
  const [savingTarget, setSavingTarget] = useState(false);
  const [targetSavedSuccess, setTargetSavedSuccess] = useState(false);

  const [refreshingGame, setRefreshingGame] = useState(false);
  const mountedRef = useRef(true);
  const delayedRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seededFollowUpRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (delayedRefreshTimeoutRef.current) {
        clearTimeout(delayedRefreshTimeoutRef.current);
      }
      if (seedTimeoutRef.current) {
        clearTimeout(seedTimeoutRef.current);
      }
    };
  }, []);

  const handleRefreshGame = async () => {
    if (!data?.game || refreshingGame) return;
    setRefreshingGame(true);
    try {
      const res = await api.refreshGame(data.game.id);
      if (mountedRef.current) {
        if (res?.game) {
          setData({
            game: res.game,
            offers: res.offers || [],
            history: res.history || [],
            intelligence: res.intelligence || undefined
          });
          if (res.game.targetPriceEur !== undefined && res.game.targetPriceEur !== null) {
            const localVal = convertEurToLocal(res.game.targetPriceEur);
            setTargetPriceInput(localVal !== null ? (currencyInfo.decimalPlaces === 0 ? Math.round(localVal).toString() : localVal.toFixed(currencyInfo.decimalPlaces)) : '');
          } else {
            setTargetPriceInput('');
          }
        }
        if (onGameUpdated) {
          onGameUpdated(gameId);
        }
      }

      if (delayedRefreshTimeoutRef.current) {
        clearTimeout(delayedRefreshTimeoutRef.current);
      }
      delayedRefreshTimeoutRef.current = setTimeout(async () => {
        if (!mountedRef.current) return;
        try {
          const [updatedDetails, updatedIntel] = await Promise.all([
            api.getGameDetails(gameId),
            api.getPriceIntelligence(gameId).catch(() => null)
          ]);
          if (mountedRef.current) {
            setData({
              ...updatedDetails,
              intelligence: updatedIntel || undefined
            });
            if (onGameUpdated) {
              onGameUpdated(gameId);
            }
          }
        } catch (err) {
          console.error('Failed delayed refresh of game details:', err);
        }
      }, 10000);
    } catch (err) {
      console.error('Failed to refresh game prices:', err);
    } finally {
      if (mountedRef.current) {
        setRefreshingGame(false);
      }
    }
  };

  const handleCopySteamUrl = async () => {
    if (!data?.game.steamAppId) return;
    try {
      await navigator.clipboard.writeText(`https://store.steampowered.com/app/${data.game.steamAppId}/`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleCopyVoucher = async (offerId: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedVoucherId(offerId);
      setTimeout(() => setCopiedVoucherId(null), 2000);
    } catch {}
  };

  const handleSaveTargetPrice = async () => {
    if (!data?.game) return;
    const parsedLocal = targetPriceInput.trim() === '' ? null : parseFloat(targetPriceInput);
    if (parsedLocal !== null && (isNaN(parsedLocal) || parsedLocal < 0)) return;

    // Convert local currency input to normalized EUR for backend storage
    const parsedEur = parsedLocal !== null ? convertLocalToEur(parsedLocal) : null;
    const finalEur = parsedEur !== null ? Math.round(parsedEur * 100) / 100 : null;
    
    setSavingTarget(true);
    try {
      await api.setTargetPrice(data.game.id, finalEur);
      setData(prev => prev ? {
        ...prev,
        game: {
          ...prev.game,
          targetPriceEur: finalEur === null ? undefined : finalEur
        }
      } : null);
      if (onTargetPriceUpdated) {
        onTargetPriceUpdated(data.game.id, finalEur);
      }
      setTargetSavedSuccess(true);
      setTimeout(() => setTargetSavedSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to update target price', err);
    } finally {
      setSavingTarget(false);
    }
  };

  const handleClearTargetPrice = async () => {
    if (!data?.game) return;
    try {
      await api.setTargetPrice(data.game.id, null);
      setTargetPriceInput('');
      setData(prev => prev ? { ...prev, game: { ...prev.game, targetPriceEur: undefined } } : null);
      if (onTargetPriceUpdated) {
        onTargetPriceUpdated(data.game.id, null);
      }
    } catch (err) {
      console.error('Failed to clear target price:', err);
    }
  };

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setData(null);
    setTargetPriceInput('');
    setTargetSavedSuccess(false);

    Promise.all([
      api.getGameDetails(gameId),
      api.getPriceIntelligence(gameId).catch(() => null)
    ])
      .then(([details, intel]) => {
        if (isMounted) {
          setData({
            ...details,
            intelligence: intel || undefined
          });
          if (details.game.targetPriceEur !== undefined && details.game.targetPriceEur !== null) {
            const localVal = convertEurToLocal(details.game.targetPriceEur);
            setTargetPriceInput(localVal !== null ? (currencyInfo.decimalPlaces === 0 ? Math.round(localVal).toString() : localVal.toFixed(currencyInfo.decimalPlaces)) : '');
          } else {
            setTargetPriceInput('');
          }
          setLoading(false);

          if (details.history.length === 0 && !seededFollowUpRef.current.has(gameId)) {
            seededFollowUpRef.current.add(gameId);
            if (seedTimeoutRef.current) {
              clearTimeout(seedTimeoutRef.current);
            }
            seedTimeoutRef.current = setTimeout(async () => {
              if (!mountedRef.current || !isMounted) return;
              try {
                const [updatedDetails, updatedIntel] = await Promise.all([
                  api.getGameDetails(gameId),
                  api.getPriceIntelligence(gameId).catch(() => null)
                ]);
                if (mountedRef.current && isMounted) {
                  setData({
                    ...updatedDetails,
                    intelligence: updatedIntel || undefined
                  });
                  if (onGameUpdated) {
                    onGameUpdated(gameId);
                  }
                }
              } catch (err) {
                console.error('Failed follow-up refresh of seeded history:', err);
              }
            }, 4000);
          }
        }
      })
      .catch(err => {
        console.error('Failed to fetch game details & intelligence:', err);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
      if (seedTimeoutRef.current) {
        clearTimeout(seedTimeoutRef.current);
      }
    };
  }, [gameId]);

  const [togglingFamily, setTogglingFamily] = useState(false);
  const [familyMessage, setFamilyMessage] = useState<string | null>(null);

  const handleExcludeFamilySharing = async (reason?: string) => {
    if (!data?.game || togglingFamily) return;
    setTogglingFamily(true);
    setFamilyMessage(null);
    try {
      await api.excludeFamilyGame(data.game.steamAppId, reason || 'Manually marked as excluded from Steam Family Sharing');
      if (mountedRef.current) {
        setData(prev => prev ? {
          ...prev,
          game: { ...prev.game, isFamilyShared: false, isFamilyExcluded: true }
        } : null);
        setFamilyMessage('Game excluded from Family Sharing.');
        onGameUpdated?.(data.game.id);
      }
    } catch (err: any) {
      console.error('Failed to exclude family game:', err);
      setFamilyMessage(err.message || 'Failed to exclude game');
    } finally {
      if (mountedRef.current) setTogglingFamily(false);
    }
  };

  const handleIncludeFamilySharing = async () => {
    if (!data?.game || togglingFamily) return;
    setTogglingFamily(true);
    setFamilyMessage(null);
    try {
      await api.includeFamilyGame(data.game.steamAppId);
      if (mountedRef.current) {
        setData(prev => prev ? {
          ...prev,
          game: { ...prev.game, isFamilyShared: true, isFamilyExcluded: false }
        } : null);
        setFamilyMessage('Family Sharing status restored.');
        onGameUpdated?.(data.game.id);
      }
    } catch (err: any) {
      console.error('Failed to restore family game:', err);
      setFamilyMessage(err.message || 'Failed to restore game');
    } finally {
      if (mountedRef.current) setTogglingFamily(false);
    }
  };

  const handleAutoCheckFamilySharing = async () => {
    if (!data?.game || togglingFamily) return;
    setTogglingFamily(true);
    setFamilyMessage(null);
    try {
      const res = await api.autoDetectFamilyExclusions([data.game.steamAppId]);
      if (mountedRef.current) {
        if (res.excludedCount > 0) {
          const item = res.newlyExcluded[0];
          setData(prev => prev ? {
            ...prev,
            game: { ...prev.game, isFamilyShared: false, isFamilyExcluded: true }
          } : null);
          setFamilyMessage(item?.reason || 'Verified: Excluded from Family Sharing by Steam.');
        } else {
          setFamilyMessage('Verified: Game supports Steam Family Sharing!');
        }
        onGameUpdated?.(data.game.id);
      }
    } catch (err: any) {
      console.error('Failed to auto-check family sharing:', err);
      setFamilyMessage(err.message || 'Failed to check Steam store status');
    } finally {
      if (mountedRef.current) setTogglingFamily(false);
    }
  };

  return {
    data,
    loading,
    copied,
    copiedVoucherId,
    targetPriceInput,
    setTargetPriceInput,
    savingTarget,
    targetSavedSuccess,
    handleCopySteamUrl,
    handleCopyVoucher,
    handleSaveTargetPrice,
    handleClearTargetPrice,
    refreshingGame,
    handleRefreshGame,
    togglingFamily,
    familyMessage,
    handleExcludeFamilySharing,
    handleIncludeFamilySharing,
    handleAutoCheckFamilySharing
  };
}
