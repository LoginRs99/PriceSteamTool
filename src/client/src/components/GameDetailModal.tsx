import React, { useEffect, useState } from 'react';
import type { Game, Offer, PriceHistoryEntry, PriceIntelligenceResponse } from '../types.js';
import { api } from '../api.js';
import { PriceChart } from './PriceChart.js';
import { 
  X, 
  ExternalLink, 
  ShieldCheck, 
  AlertTriangle, 
  Flame, 
  Clock, 
  Sparkles, 
  Trophy, 
  CheckCircle, 
  TrendingDown, 
  Activity, 
  Scale, 
  Calendar,
  Copy,
  Check
} from 'lucide-react';

interface GameDetailModalProps {
  gameId: string;
  onClose: () => void;
}

export const GameDetailModal: React.FC<GameDetailModalProps> = ({ gameId, onClose }) => {
  const [data, setData] = useState<{ 
    game: Game; 
    offers: Offer[]; 
    history: PriceHistoryEntry[];
    intelligence?: PriceIntelligenceResponse;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [targetPriceInput, setTargetPriceInput] = useState<string>('');
  const [savingTarget, setSavingTarget] = useState(false);
  const [targetSavedSuccess, setTargetSavedSuccess] = useState(false);

  const handleCopySteamUrl = async () => {
    if (!data?.game.steamAppId) return;
    try {
      await navigator.clipboard.writeText(`https://store.steampowered.com/app/${data.game.steamAppId}/`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
      setTargetSavedSuccess(true);
      setTimeout(() => setTargetSavedSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to update target price', err);
    } finally {
      setSavingTarget(false);
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

  if (loading || !data) {
    return (
      <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Loading game details">
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ padding: 40, textAlign: 'center' }}>
          <p>Loading price intelligence & deal history...</p>
        </div>
      </div>
    );
  }

  const { game, offers, history, intelligence } = data;
  const bestOffer = offers.find(o => o.isBestDeal) || offers[0];

  const bestDealScore = bestOffer?.dealScore ?? game.bestDealScore ?? 0;
  const bestDealTier = bestOffer?.dealTier ?? game.bestDealTier ?? 'Fair';
  const tierColor = 
    bestDealTier === 'Exceptional' ? '#8b5cf6' : 
    bestDealTier === 'Great' ? '#10b981' : 
    bestDealTier === 'Fair' ? '#3b82f6' : '#64748b';

  const advice = intelligence?.advice || {
    decision: 'FAIR' as const,
    confidence: 'MEDIUM' as const,
    headline: 'Market Price Analysis',
    reasoning: ['Analysis based on current offers and available price history.']
  };

  const adviceColor = 
    advice.decision === 'BUY' ? '#10b981' : 
    advice.decision === 'FAIR' ? '#38bdf8' : '#f59e0b';

  const adviceBg = 
    advice.decision === 'BUY' ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(21, 29, 46, 0.95) 100%)' :
    advice.decision === 'FAIR' ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, rgba(21, 29, 46, 0.95) 100%)' :
    'linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(21, 29, 46, 0.95) 100%)';

  const periodLows = intelligence?.periodLows;
  const typicalSale = intelligence?.typicalSale;
  const frequency = intelligence?.frequency;
  const volatility = intelligence?.volatility;
  const marketComp = intelligence?.marketComparison;

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="game-detail-title">
      <div className="modal-content modal-intel-content" onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div>
            <h2 id="game-detail-title" style={{ fontSize: 20, fontWeight: 800 }}>{game.title}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <a 
                href={`https://store.steampowered.com/app/${game.steamAppId}/`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
              >
                Steam Store (AppID: {game.steamAppId}) <ExternalLink size={12} />
              </a>

              <button
                type="button"
                className="btn btn-outline"
                style={{ padding: '2px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={handleCopySteamUrl}
                title="Copy Steam Store URL to clipboard"
              >
                {copied ? <Check size={11} color="#10b981" /> : <Copy size={11} />}
                <span>{copied ? 'Copied URL!' : 'Copy Link'}</span>
              </button>
            </div>
          </div>
          <button className="btn btn-outline" onClick={onClose} style={{ padding: 6 }} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body">
          {/* 1. Buy / Fair / Wait Decision Hero */}
          <div style={{
            background: adviceBg,
            border: `1px solid ${adviceColor}44`,
            borderRadius: 'var(--radius-lg)',
            padding: 20,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 16
          }}>
            <div style={{ flex: '1 1 340px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span 
                  className="advice-decision-badge"
                  style={{ background: adviceColor, color: '#042f2e' }}
                >
                  {advice.decision === 'BUY' && <Sparkles size={13} />}
                  {advice.decision === 'FAIR' && <Scale size={13} />}
                  {advice.decision === 'WAIT' && <Clock size={13} />}
                  <span>{advice.decision}</span>
                </span>

                <span style={{ fontSize: 14, fontWeight: 700, color: adviceColor }}>
                  {advice.headline}
                </span>
              </div>

              <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#f8fafc', margin: '6px 0' }}>
                €{bestOffer ? bestOffer.priceEur.toFixed(2) : (game.basePriceEur?.toFixed(2) ?? '—')}
                {bestOffer && (bestOffer.discountPercent || 0) > 0 && (
                  <span style={{ fontSize: 14, color: 'var(--text-muted)', marginLeft: 8, textDecoration: 'line-through' }}>
                    €{bestOffer.originalPriceEur?.toFixed(2)}
                  </span>
                )}
                {bestOffer?.rawCurrency && bestOffer.rawCurrency !== 'EUR' && bestOffer.rawPrice && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8, fontWeight: 400 }}>
                    ({bestOffer.rawPrice.toFixed(2)} {bestOffer.rawCurrency})
                  </span>
                )}
              </div>

              {/* Reasoning Bullet Points */}
              <ul className="advice-reasons-list">
                {advice.reasoning.map((r, idx) => (
                  <li key={idx}>
                    <CheckCircle size={12} color={adviceColor} style={{ flexShrink: 0, marginTop: 3 }} />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            {bestOffer && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                  Best offer sold by <strong>{bestOffer.merchantName}</strong>
                </div>
                <a
                  href={bestOffer.dealUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                  style={{ padding: '10px 22px', fontSize: 14 }}
                >
                  <span>Go to Deal</span>
                  <ExternalLink size={15} />
                </a>
              </div>
            )}
          </div>

          {/* 1.5 Target Price Discord Alert Configuration */}
          <div style={{
            background: 'rgba(56, 189, 248, 0.05)',
            border: '1px solid rgba(56, 189, 248, 0.18)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>🎯</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                  Discord Target Price Alert
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Notify me at or below this price (bypasses global Deal Score thresholds)
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: 10, fontSize: 13, color: 'var(--text-muted)', pointerEvents: 'none' }}>€</span>
                <input
                  type="number"
                  step="0.50"
                  min="0"
                  placeholder="e.g. 14.99"
                  value={targetPriceInput}
                  onChange={(e) => setTargetPriceInput(e.target.value)}
                  style={{
                    width: 105,
                    padding: '6px 10px 6px 24px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-surface-elevated)',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                    fontFamily: 'var(--font-mono)'
                  }}
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleSaveTargetPrice}
                disabled={savingTarget}
                style={{ padding: '6px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                {targetSavedSuccess ? <Check size={14} color="#10b981" /> : <Sparkles size={14} />}
                <span>{savingTarget ? 'Saving...' : targetSavedSuccess ? 'Saved!' : 'Set Target'}</span>
              </button>
              {data.game.targetPriceEur !== undefined && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setTargetPriceInput('');
                    api.setTargetPrice(data.game.id, null).then(() => {
                      setData(prev => prev ? { ...prev, game: { ...prev.game, targetPriceEur: undefined } } : null);
                    });
                  }}
                  style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)' }}
                  title="Remove target price"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* 2. Rolling Period Lows Bar */}
          {periodLows && (
            <div>
              <h4 className="section-subtitle">
                <Flame size={15} color="#f59e0b" />
                <span>Rolling Period Lows & Confirmed ATL</span>
              </h4>

              <div className="period-lows-grid">
                <div className="period-card">
                  <span className="period-label">7-Day Low</span>
                  <div className="period-value">
                    {periodLows.low7d.priceEur !== null ? `€${periodLows.low7d.priceEur.toFixed(2)}` : '—'}
                  </div>
                  <span className="period-meta">
                    {periodLows.low7d.merchantName || (periodLows.low7d.isExactPeriodData ? 'No price drops' : 'No 7d coverage')}
                  </span>
                </div>

                <div className="period-card">
                  <span className="period-label">30-Day Low</span>
                  <div className="period-value">
                    {periodLows.low30d.priceEur !== null ? `€${periodLows.low30d.priceEur.toFixed(2)}` : '—'}
                  </div>
                  <span className="period-meta">
                    {periodLows.low30d.merchantName || (periodLows.low30d.isExactPeriodData ? 'No price drops' : 'Insufficient span')}
                  </span>
                </div>

                <div className="period-card">
                  <span className="period-label">90-Day Low</span>
                  <div className="period-value">
                    {periodLows.low90d.priceEur !== null ? `€${periodLows.low90d.priceEur.toFixed(2)}` : '—'}
                  </div>
                  <span className="period-meta">
                    {periodLows.low90d.merchantName || (periodLows.low90d.isExactPeriodData ? 'No price drops' : 'Insufficient span')}
                  </span>
                </div>

                <div className="period-card">
                  <span className="period-label">1-Year Low</span>
                  <div className="period-value">
                    {periodLows.low1y.priceEur !== null ? `€${periodLows.low1y.priceEur.toFixed(2)}` : '—'}
                  </div>
                  <span className="period-meta">
                    {periodLows.low1y.merchantName || (periodLows.low1y.isExactPeriodData ? 'No price drops' : 'Insufficient span')}
                  </span>
                </div>

                <div className="period-card atl-card">
                  <span className="period-label" style={{ color: '#f59e0b' }}>All-Time Low</span>
                  <div className="period-value" style={{ color: '#f59e0b' }}>
                    €{periodLows.allTimeLow.priceEur.toFixed(2)}
                  </div>
                  <span className="period-meta">
                    {periodLows.allTimeLow.isConfirmed ? `Confirmed (${periodLows.allTimeLow.source || 'ITAD/Steam'})` : 'Observed low'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 3. Interactive Price History Chart */}
          {intelligence?.chartData && (
            <PriceChart data={intelligence.chartData} />
          )}

          {/* 4. Price Intelligence Metrics Grid */}
          <div className="intel-metrics-grid">
            <div className="intel-card">
              <div className="intel-card-header">
                <span className="intel-label">Typical Sale Price</span>
                <TrendingDown size={15} color="#38bdf8" />
              </div>
              <div className="intel-value" style={{ color: '#38bdf8' }}>
                {typicalSale?.medianPriceEur !== null ? `€${typicalSale?.medianPriceEur?.toFixed(2)}` : '—'}
              </div>
              <span className="intel-sub">
                {typicalSale && typicalSale.medianPriceEur !== null
                  ? `IQR Range: €${typicalSale.q1PriceEur?.toFixed(2)} – €${typicalSale.q3PriceEur?.toFixed(2)} (${typicalSale.sampleCount} sales)`
                  : 'Insufficient historical sales'}
              </span>
            </div>

            <div className="intel-card">
              <div className="intel-card-header">
                <span className="intel-label">Sale Frequency</span>
                <Calendar size={15} color="#8b5cf6" />
              </div>
              <div className="intel-value" style={{ color: '#a78bfa' }}>
                {frequency?.frequencyCategory || 'Rare'}
              </div>
              <span className="intel-sub">
                {frequency && frequency.saleEventsLast12m > 0
                  ? `${frequency.saleEventsLast12m} sales in last 12 mo (${frequency.avgDaysBetweenSales ? `~${frequency.avgDaysBetweenSales}d apart` : 'single period'})`
                  : 'No sales recorded in 12 mo'}
              </span>
            </div>

            <div className="intel-card">
              <div className="intel-card-header">
                <span className="intel-label">Price Volatility</span>
                <Activity size={15} color="#f59e0b" />
              </div>
              <div className="intel-value" style={{ color: '#f59e0b' }}>
                {volatility?.category || 'Stable'}
              </div>
              <span className="intel-sub">
                {volatility
                  ? `${volatility.priceChangesCount} price shifts on observed days (CV: ${volatility.rawCv})`
                  : 'Stable pricing'}
              </span>
            </div>

            <div className="intel-card">
              <div className="intel-card-header">
                <span className="intel-label">Price vs Market</span>
                <Scale size={15} color="#10b981" />
              </div>
              <div className="intel-value" style={{ color: '#10b981' }}>
                {marketComp && marketComp.totalCompatibleOffers > 0
                  ? `#${marketComp.currentRank} of ${marketComp.totalCompatibleOffers}`
                  : '#1 of 1'}
              </div>
              <span className="intel-sub">
                {marketComp && marketComp.percentBelowMarketMedian > 0
                  ? `${marketComp.percentBelowMarketMedian}% below market median (€${marketComp.marketMedianEur.toFixed(2)})`
                  : 'At current market median'}
              </span>
            </div>
          </div>

          {/* 5. All Available Offers Table */}
          <div>
            <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
              All Available Offers ({offers.length})
            </h4>

            {offers.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No offers currently recorded for this game. Run a sync to fetch prices.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="offers-table">
                  <thead>
                    <tr>
                      <th>Merchant</th>
                      <th>Deal Score</th>
                      <th>Type & Region</th>
                      <th>Price (EUR / Raw)</th>
                      <th>Sources</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offers.map(offer => {
                      const score = offer.dealScore ?? 0;
                      const tier = offer.dealTier || 'Fair';
                      const color = 
                        tier === 'Exceptional' ? '#8b5cf6' : 
                        tier === 'Great' ? '#10b981' : 
                        tier === 'Fair' ? '#3b82f6' : '#64748b';

                      return (
                        <tr key={offer.id}>
                          <td>
                            <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                              {offer.merchantName}
                              {offer.isOfficial && (
                                <span title="Official Authorized Retailer" style={{ display: 'inline-flex', alignItems: 'center' }}>
                                  <ShieldCheck size={14} color="#10b981" />
                                </span>
                              )}
                            </div>
                            
                            {/* Evaluation Flags */}
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                              {offer.priceEvent === 'NEW_HISTORICAL_LOW' && (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', borderRadius: 3 }}>
                                  🏆 ALL-TIME LOW
                                </span>
                              )}
                              {offer.priceEvent === 'EXTREME_DROP' && (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', background: 'rgba(139, 92, 246, 0.2)', color: '#a78bfa', borderRadius: 3 }}>
                                  🔥 MEGA DEAL
                                </span>
                              )}
                              {offer.priceEvent === 'MAJOR_DROP' && (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', borderRadius: 3 }}>
                                  ✨ MAJOR DROP
                                </span>
                              )}
                              {offer.riskLevel === 'HIGH' ? (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', borderRadius: 3, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                  <AlertTriangle size={10} /> HIGH RISK
                                </span>
                              ) : offer.riskLevel === 'MEDIUM' ? (
                                <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', borderRadius: 3 }}>
                                  ⚠️ CAUTION
                                </span>
                              ) : null}
                            </div>

                            {offer.isAnomaly && (
                              <span style={{ fontSize: 11, color: '#f87171', display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                                <AlertTriangle size={11} /> {offer.anomalyReason || 'Anomaly'}
                              </span>
                            )}
                          </td>
                          <td>
                            {score > 0 ? (
                              <span 
                                style={{ 
                                  fontSize: 11, 
                                  fontWeight: 800, 
                                  padding: '2px 8px', 
                                  borderRadius: 12, 
                                  background: color, 
                                  color: '#fff',
                                  display: 'inline-block'
                                }}
                              >
                                {score} • {tier}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                            )}
                          </td>
                          <td>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                              {offer.productType.replace('_', ' ')}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                              {offer.regionType}
                            </div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                              €{offer.priceEur.toFixed(2)}
                            </div>
                            {(offer.discountPercent || 0) > 0 && (
                              <span style={{ fontSize: 11, color: '#34d399' }}>
                                -{offer.discountPercent}%
                              </span>
                            )}
                            {offer.rawCurrency && offer.rawCurrency !== 'EUR' && offer.rawPrice && (
                              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                                {offer.rawPrice.toFixed(2)} {offer.rawCurrency}
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                              {offer.sources.map(s => (
                                <span 
                                  key={s} 
                                  style={{ 
                                    fontSize: 10, 
                                    padding: '2px 6px', 
                                    background: 'var(--bg-surface-elevated)', 
                                    borderRadius: 4,
                                    textTransform: 'uppercase',
                                    color: 'var(--text-muted)'
                                  }}
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>
                            <a
                              href={offer.dealUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-secondary"
                              style={{ padding: '4px 10px', fontSize: 12 }}
                            >
                              Buy
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 6. Price History Table */}
          {history.length > 0 && (
            <div>
              <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={15} /> Recorded Price History ({history.length})
              </h4>
              <div style={{ maxHeight: 180, overflowY: 'auto', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', padding: 12 }}>
                <table className="offers-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Store</th>
                      <th>Source</th>
                      <th>Price</th>
                      <th>Event / Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(h => (
                      <tr key={h.id}>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {new Date(h.recordedAt).toLocaleDateString()} {new Date(h.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ fontSize: 13 }}>
                          {h.merchantName || 'Store'} {h.isOfficial && <ShieldCheck size={12} color="#10b981" style={{ display: 'inline', verticalAlign: 'middle' }} />}
                        </td>
                        <td style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{h.sourceCode}</td>
                        <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                          €{h.priceEur.toFixed(2)}
                          {h.discountPercent && h.discountPercent > 0 && (
                            <span style={{ fontSize: 11, color: '#34d399', marginLeft: 6 }}>-{h.discountPercent}%</span>
                          )}
                        </td>
                        <td>
                          {h.dealScore ? (
                            <span style={{ fontSize: 11, color: 'var(--accent-primary)', fontWeight: 700 }}>
                              Score: {h.dealScore}
                            </span>
                          ) : h.priceEvent ? (
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                              {h.priceEvent}
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
