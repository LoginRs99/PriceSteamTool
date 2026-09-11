import React, { useEffect, useRef } from 'react';
import type { Game } from '../types.js';
import { X, HelpCircle, Award, ShieldCheck, Database, Calendar, TrendingDown, Info, AlertTriangle } from 'lucide-react';

interface ScoreExplainModalProps {
  game: Game | null;
  onClose: () => void;
}

export const ScoreExplainModal: React.FC<ScoreExplainModalProps> = ({ game, onClose }) => {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!game) return null;

  const score = game.bestDealScore ?? 0;
  const tier = game.bestDealTier || 'Fair';
  const isProvisional = Boolean(game.bestIsProvisional);

  const tierColor = 
    tier === 'Exceptional' ? 'var(--accent-purple)' : 
    tier === 'Great' ? 'var(--down)' : 
    tier === 'Good' ? 'var(--accent-blue)' :
    'var(--dim)';

  const currentPrice = game.bestPriceEur ?? 0;
  const medianPrice = game.typicalSaleMedianEur ?? game.basePriceEur ?? currentPrice;
  const savingEur = game.bestSavingVsMedianEur ?? Math.max(0, medianPrice - currentPrice);
  const atl = game.historicalLowEur ?? currentPrice;
  const atlDist = game.bestAtlDistanceEur ?? Math.max(0, currentPrice - atl);
  const sampleCount = game.typicalSaleSampleCount ?? 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content score-explain-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <HelpCircle size={22} color={tierColor} />
            <div>
              <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Deal Score Breakdown</h2>
              <span style={{ fontSize: '0.85rem', color: 'var(--dim)' }}>{game.title}</span>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close modal">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Top Deal Score Card */}
          <div style={{ background: 'var(--surface)', padding: '14px 16px', borderRadius: 'var(--radius-md)', borderLeft: `4px solid ${tierColor}`, border: '1px solid var(--line)' }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--dim)', marginBottom: 4 }}>
              Deal Score (Price Quality)
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="ticker-num" style={{ fontSize: '2rem', fontWeight: 800, color: tierColor }}>{score}</span>
              <span style={{ fontSize: '1rem', fontWeight: 600, color: tierColor }}>/ 100</span>
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: 4 }}>
              Tier: <span style={{ color: tierColor }}>{tier}</span>
              {isProvisional && <span style={{ marginLeft: 6, color: 'var(--signal)', fontSize: '0.75rem' }}>(Provisional)</span>}
            </div>
          </div>

          {/* Pricing Error / Glitch Alert Banner */}
          {(game.bestPriceEvent === 'PRICING_ERROR' || ((game.bestRiskLevel === 'HIGH' || game.hasAnomaly) && (game.bestDiscountPercent ?? 0) >= 75)) ? (
            <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.45)', padding: 12, borderRadius: 'var(--radius-md)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>⚡</span>
              <div style={{ fontSize: '0.82rem', color: 'var(--ink)' }}>
                <strong>⚡ Potential Pricing Error!</strong> This offer is dramatically cheaper than the market median and other stores. If this is an unintended pricing glitch, the store may soon correct or cancel orders — consider purchasing immediately if you want the game!
              </div>
            </div>
          ) : (game.bestRiskLevel === 'HIGH' || game.hasAnomaly) ? (
            <div style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.35)', padding: 12, borderRadius: 'var(--radius-md)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: '0.82rem', color: 'var(--ink)' }}>
                <strong>Safety Anomaly Suppression:</strong> The lowest detected price is an isolated, unverified outlier on an aggregator. To prevent misleading alerts, Deal Score is suppressed until corroborated by at least one independent store source.
              </div>
            </div>
          ) : null}

          {/* Provisional Guard Warning if active */}
          {isProvisional && (
            <div style={{ background: 'var(--signal-dim)', border: '1px solid rgba(251, 191, 36, 0.3)', padding: 12, borderRadius: 'var(--radius-md)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} color="var(--signal)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: '0.82rem', color: 'var(--ink)' }}>
                <strong>Provisional Score Cap (Max 65):</strong> This game has limited historical observations ({sampleCount} recorded sales). Full Exceptional status (85–100) requires at least 3 historical datapoints to prevent false alerts.
              </div>
            </div>
          )}

          {/* Mathematical Anchor Breakdown */}
          <div>
            <h4 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--dim)', marginBottom: 10 }}>
              Price Comparison Anchors
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', fontSize: '0.88rem' }}>
                <span style={{ color: 'var(--dim)' }}>Current Best Price:</span>
                <span className="ticker-num" style={{ fontWeight: 700, color: 'var(--ink)' }}>€{currentPrice.toFixed(2)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', fontSize: '0.88rem' }}>
                <span style={{ color: 'var(--dim)' }}>Typical Sale Price (Historical Median):</span>
                <span className="ticker-num" style={{ fontWeight: 600 }}>€{medianPrice.toFixed(2)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', fontSize: '0.88rem' }}>
                <span style={{ color: 'var(--dim)' }}>Historical Savings vs Typical:</span>
                <span className="ticker-num" style={{ fontWeight: 700, color: savingEur > 0 ? 'var(--down)' : 'inherit' }}>
                  {savingEur > 0 ? `€${savingEur.toFixed(2)} cheaper (${Math.round((savingEur / medianPrice) * 100)}% off typical)` : 'At or above typical sale'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', fontSize: '0.88rem' }}>
                <span style={{ color: 'var(--dim)' }}>Confirmed All-Time Low (ATL):</span>
                <span className="ticker-num" style={{ fontWeight: 600 }}>
                  €{atl.toFixed(2)} {atlDist === 0 ? '★ (Matches Record ATL)' : `(+€${atlDist.toFixed(2)})`}
                </span>
              </div>
            </div>
          </div>

          {/* Action Signal & Discount Cycle Forecasting */}
          {game.actionSignal && (
            <div>
              <h4 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', marginBottom: 10 }}>
                Action Signal & Sale Forecast
              </h4>
              <div style={{ background: 'var(--bg-secondary)', padding: '14px 16px', borderRadius: 10, borderLeft: `4px solid ${game.actionSignal.badgeColor}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span 
                      style={{ 
                        background: `${game.actionSignal.badgeColor}22`, 
                        color: game.actionSignal.badgeColor, 
                        border: `1px solid ${game.actionSignal.badgeColor}55`, 
                        padding: '3px 10px', 
                        borderRadius: 6, 
                        fontWeight: 700, 
                        fontSize: '0.85rem' 
                      }}
                    >
                      {game.actionSignal.badgeLabel}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      Urgency: <strong style={{ color: game.actionSignal.urgency === 'HIGH' ? '#10b981' : 'inherit' }}>{game.actionSignal.urgency}</strong>
                    </span>
                  </div>
                  {game.actionSignal.expectedSaleTargetEur && (
                    <div style={{ fontSize: '0.82rem', textAlign: 'right' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Expected sale target: </span>
                      <strong style={{ color: '#10b981' }}>€{game.actionSignal.expectedSaleTargetEur.toFixed(2)}</strong>
                    </div>
                  )}
                </div>

                <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                  {game.actionSignal.primaryReason}
                </div>

                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--bg-surface-elevated)', padding: '8px 12px', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div><strong>Timing context:</strong> {game.actionSignal.timingContext}</div>
                  {game.actionSignal.avgDaysBetweenSales !== undefined && (
                    <div style={{ display: 'flex', gap: 12, marginTop: 2, fontSize: '0.75rem' }}>
                      <span>Average sale cycle: <strong>~{game.actionSignal.avgDaysBetweenSales} days</strong></span>
                      {game.actionSignal.daysSinceLastSale !== undefined && (
                        <span>Since last sale: <strong>{game.actionSignal.daysSinceLastSale} days</strong></span>
                      )}
                      {game.actionSignal.isSaleOverdue && (
                        <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚡ Sale expected soon</span>
                      )}
                    </div>
                  )}
                  {game.actionSignal.upcomingEventName && (
                    <div style={{ marginTop: 2, color: game.actionSignal.daysUntilUpcomingEvent && game.actionSignal.daysUntilUpcomingEvent <= 14 ? '#f59e0b' : 'inherit', fontSize: '0.75rem' }}>
                      📅 Next major event: <strong>{game.actionSignal.upcomingEventName}</strong> (in {game.actionSignal.daysUntilUpcomingEvent} days)
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Explanation Footer Note */}
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4, borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
            <Info size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
            Deal Score measures how deeply discounted the current price is compared to the game's actual historical pricing pattern. It never judges merchant reputation or brand bias.
          </div>
        </div>
      </div>
    </div>
  );
};
