import { useEffect, useState } from 'react';
import type { Game, Offer, PriceHistoryEntry, PriceIntelligenceResponse } from '../../types.js';
import { api } from '../../api.js';

export function useGameIntelligence(
  gameId: string,
  onClose: () => void,
  onTargetPriceUpdated?: (gameId: string, targetPriceEur: number | null) => void,
  onGameUpdated?: (gameId: string) => void
) {
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

  // AllKeyShop Candidate Selector State
  const [aksCandidates, setAksCandidates] = useState<{ id: number; name: string; slug?: string }[]>([]);
  const [currentAksOverride, setCurrentAksOverride] = useState<string | number | null>(null);
  const [showAksSelector, setShowAksSelector] = useState(false);
  const [customAksInput, setCustomAksInput] = useState('');
  const [loadingAksCandidates, setLoadingAksCandidates] = useState(false);
  const [savingAksOverride, setSavingAksOverride] = useState(false);
  const [aksOverrideSuccess, setAksOverrideSuccess] = useState(false);

  const handleOpenAksSelector = async () => {
    if (!data?.game) return;
    setShowAksSelector(prev => !prev);
    if (!showAksSelector && aksCandidates.length === 0) {
      setLoadingAksCandidates(true);
      try {
        const res = await api.getAllkeyshopCandidates(data.game.id);
        setAksCandidates(res.candidates || []);
        setCurrentAksOverride(res.currentOverride);
        if (typeof res.currentOverride === 'string') {
          setCustomAksInput(res.currentOverride);
        } else if (typeof res.currentOverride === 'number') {
          setCustomAksInput(String(res.currentOverride));
        }
      } catch (err) {
        console.error('Failed to load AllKeyShop candidates', err);
      } finally {
        setLoadingAksCandidates(false);
      }
    }
  };

  const handleApplyAksOverride = async (overrideValue: string | number | null) => {
    if (!data?.game) return;
    setSavingAksOverride(true);
    try {
      await api.setAllkeyshopOverride(data.game.id, overrideValue);
      setCurrentAksOverride(overrideValue);
      setAksOverrideSuccess(true);
      setTimeout(() => setAksOverrideSuccess(false), 2500);

      // Refresh details in real-time
      const [updatedDetails, updatedIntel] = await Promise.all([
        api.getGameDetails(gameId),
        api.getPriceIntelligence(gameId).catch(() => null)
      ]);
      setData({
        ...updatedDetails,
        intelligence: updatedIntel || undefined
      });
      if (onGameUpdated) {
        onGameUpdated(gameId);
      }
    } catch (err) {
      console.error('Failed to apply AllKeyShop override', err);
    } finally {
      setSavingAksOverride(false);
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
    const parsed = targetPriceInput.trim() === '' ? null : parseFloat(targetPriceInput);
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) return;
    
    setSavingTarget(true);
    try {
      await api.setTargetPrice(data.game.id, parsed);
      setData(prev => prev ? {
        ...prev,
        game: {
          ...prev.game,
          targetPriceEur: parsed === null ? undefined : parsed
        }
      } : null);
      if (onTargetPriceUpdated) {
        onTargetPriceUpdated(data.game.id, parsed);
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
    setTargetPriceInput('');
    await api.setTargetPrice(data.game.id, null);
    setData(prev => prev ? { ...prev, game: { ...prev.game, targetPriceEur: undefined } } : null);
    if (onTargetPriceUpdated) {
      onTargetPriceUpdated(data.game.id, null);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    let isMounted = true;
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
            setTargetPriceInput(details.game.targetPriceEur.toFixed(2));
          } else {
            setTargetPriceInput('');
          }
          setLoading(false);
        }
      })
      .catch(err => {
        console.error('Failed to fetch game details & intelligence:', err);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [gameId, onClose]);

  return {
    data,
    loading,
    copied,
    copiedVoucherId,
    targetPriceInput,
    setTargetPriceInput,
    savingTarget,
    targetSavedSuccess,
    aksCandidates,
    currentAksOverride,
    showAksSelector,
    customAksInput,
    setCustomAksInput,
    loadingAksCandidates,
    savingAksOverride,
    aksOverrideSuccess,
    handleOpenAksSelector,
    handleApplyAksOverride,
    handleCopySteamUrl,
    handleCopyVoucher,
    handleSaveTargetPrice,
    handleClearTargetPrice
  };
}
