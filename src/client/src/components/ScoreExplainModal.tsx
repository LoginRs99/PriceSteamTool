import React from 'react';
import type { Game } from '../types.js';
import { X, HelpCircle, Award, ShieldCheck, Database, Calendar, TrendingDown, Info, AlertTriangle } from 'lucide-react';

interface ScoreExplainModalProps {
  game: Game | null;
  onClose: () => void;
}

export const ScoreExplainModal: React.FC<ScoreExplainModalProps> = ({ game, onClose }) => {
  if (!game) return null;

  const score = game.bestDealScore ?? 0;
  const tier = game.bestDealTier || 'Fair';
  const isProvisional = Boolean(game.bestIsProvisional);

  const tierColor = 
    tier === 'Exceptional' ? '#8b5cf6' : 
    tier === 'Great' ? '#10b981' : 
    tier === 'Good' ? '#06b6d4' :
    tier === 'Fair' ? '#3b82f6' : '#64748b';

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
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{game.title}</span>
            </div>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Top Deal Score Card */}
          <div style={{ background: 'var(--bg-secondary)', padding: '14px 16px', borderRadius: 10, borderLeft: `4px solid ${tierColor}` }}>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Deal Score (Price Quality)
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: '2rem', fontWeight: 800, color: tierColor }}>{score}</span>
              <span style={{ fontSize: '1rem', fontWeight: 600, color: tierColor }}>/ 100</span>
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: 4 }}>
              Tier: <span style={{ color: tierColor }}>{tier}</span>
              {isProvisional && <span style={{ marginLeft: 6, color: '#f59e0b', fontSize: '0.75rem' }}>(Provisional)</span>}
            </div>
          </div>

          {/* Provisional Guard Warning if active */}
          {isProvisional && (
            <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: 12, borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                <strong>Provisional Score Cap (Max 65):</strong> This game has limited historical observations ({sampleCount} recorded sales). Full Exceptional status (85–100) requires at least 3 historical datapoints to prevent false alerts.
              </div>
            </div>
          )}

          {/* Mathematical Anchor Breakdown */}
          <div>
            <h4 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', marginBottom: 10 }}>
              Price Comparison Anchors
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.88rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Current Best Price:</span>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>€{currentPrice.toFixed(2)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.88rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Typical Sale Price (Historical Median):</span>
                <span style={{ fontWeight: 600 }}>€{medianPrice.toFixed(2)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.88rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Historical Savings vs Typical:</span>
                <span style={{ fontWeight: 700, color: savingEur > 0 ? '#10b981' : 'inherit' }}>
                  {savingEur > 0 ? `€${savingEur.toFixed(2)} cheaper (${Math.round((savingEur / medianPrice) * 100)}% off typical)` : 'At or above typical sale'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.88rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Confirmed All-Time Low (ATL):</span>
                <span style={{ fontWeight: 600 }}>
                  €{atl.toFixed(2)} {atlDist === 0 ? '★ (Matches Record ATL)' : `(+€${atlDist.toFixed(2)})`}
                </span>
              </div>
            </div>
          </div>

          {/* Action Signal & Discount Cycle Forecasting */}
          {game.actionSignal && (
            <div>
              <h4 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', marginBottom: 10 }}>
                Action Signal & Akció-előrejelzés
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
                      Sürgősség: <strong style={{ color: game.actionSignal.urgency === 'HIGH' ? '#10b981' : 'inherit' }}>{game.actionSignal.urgency}</strong>
                    </span>
                  </div>
                  {game.actionSignal.expectedSaleTargetEur && (
                    <div style={{ fontSize: '0.82rem', textAlign: 'right' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Várható akciós célár: </span>
                      <strong style={{ color: '#10b981' }}>€{game.actionSignal.expectedSaleTargetEur.toFixed(2)}</strong>
                    </div>
                  )}
                </div>

                <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                  {game.actionSignal.primaryReason}
                </div>

                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--bg-surface-elevated)', padding: '8px 12px', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div><strong>Időzítési kontextus:</strong> {game.actionSignal.timingContext}</div>
                  {game.actionSignal.avgDaysBetweenSales !== undefined && (
                    <div style={{ display: 'flex', gap: 12, marginTop: 2, fontSize: '0.75rem' }}>
                      <span>Átlagos akció-ciklus: <strong>~{game.actionSignal.avgDaysBetweenSales} nap</strong></span>
                      {game.actionSignal.daysSinceLastSale !== undefined && (
                        <span>Utolsó akció óta: <strong>{game.actionSignal.daysSinceLastSale} nap</strong></span>
                      )}
                      {game.actionSignal.isSaleOverdue && (
                        <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚡ Új akció esedékes</span>
                      )}
                    </div>
                  )}
                  {game.actionSignal.upcomingEventName && (
                    <div style={{ marginTop: 2, color: game.actionSignal.daysUntilUpcomingEvent && game.actionSignal.daysUntilUpcomingEvent <= 14 ? '#f59e0b' : 'inherit', fontSize: '0.75rem' }}>
                      📅 Következő nagy vásár: <strong>{game.actionSignal.upcomingEventName}</strong> ({game.actionSignal.daysUntilUpcomingEvent} nap múlva)
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
