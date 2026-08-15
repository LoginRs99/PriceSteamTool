import React, { useEffect, useState } from 'react';
import type { Game, Offer, PriceHistoryEntry } from '../types.js';
import { api } from '../api.js';
import { X, ExternalLink, ShieldCheck, AlertTriangle, Flame, Clock } from 'lucide-react';

interface GameDetailModalProps {
  gameId: string;
  onClose: () => void;
}

export const GameDetailModal: React.FC<GameDetailModalProps> = ({ gameId, onClose }) => {
  const [data, setData] = useState<{ game: Game; offers: Offer[]; history: PriceHistoryEntry[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    api.getGameDetails(gameId)
      .then(res => {
        if (isMounted) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(err => {
        console.error('Failed to fetch game details:', err);
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [gameId]);

  if (loading || !data) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ padding: 40, textAlign: 'center' }}>
          <p>Loading game deals & price history...</p>
        </div>
      </div>
    );
  }

  const { game, offers, history } = data;
  const bestOffer = offers.find(o => o.isBestDeal) || offers[0];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>{game.title}</h2>
            <a 
              href={`https://store.steampowered.com/app/${game.steamAppId}/`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none', marginTop: 4 }}
            >
              Steam Store (AppID: {game.steamAppId}) <ExternalLink size={12} />
            </a>
          </div>
          <button className="btn btn-outline" onClick={onClose} style={{ padding: 6 }}>
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body">
          {/* Best Deal Hero */}
          {bestOffer && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(21, 29, 46, 0.95) 100%)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              borderRadius: 'var(--radius-lg)',
              padding: 20,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16
            }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent-primary)', letterSpacing: 0.5 }}>
                  Best Valid Deal
                </span>
                <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#34d399', margin: '4px 0' }}>
                  €{bestOffer.priceEur.toFixed(2)}
                  {(bestOffer.discountPercent || 0) > 0 && (
                    <span style={{ fontSize: 14, color: 'var(--text-muted)', marginLeft: 8, textDecoration: 'line-through' }}>
                      €{bestOffer.originalPriceEur?.toFixed(2)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Sold by <strong>{bestOffer.merchantName}</strong> ({bestOffer.productType.replace('_', ' ')}) • {bestOffer.regionType}
                </div>
              </div>

              <a
                href={bestOffer.dealUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ padding: '12px 24px', fontSize: 15 }}
              >
                <span>Go to Deal</span>
                <ExternalLink size={16} />
              </a>
            </div>
          )}

          {/* Historical Low & Stats Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div style={{ background: 'var(--bg-surface-elevated)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Historical Low</span>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-gold)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Flame size={18} />
                <span>{game.historicalLowEur !== undefined ? `€${game.historicalLowEur.toFixed(2)}` : '—'}</span>
              </div>
              {game.historicalLowSource && (
                <span style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, display: 'block' }}>
                  Recorded via {game.historicalLowSource}
                </span>
              )}
            </div>

            <div style={{ background: 'var(--bg-surface-elevated)', padding: 16, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Steam MSRP</span>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
                {game.basePriceEur !== undefined ? `€${game.basePriceEur.toFixed(2)}` : '—'}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, display: 'block' }}>
                Release: {game.releaseDate || 'Unknown'}
              </span>
            </div>
          </div>

          {/* All Offers Table */}
          <div>
            <h4 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
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
                      <th>Type</th>
                      <th>Region</th>
                      <th>Price</th>
                      <th>Sources</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offers.map(offer => (
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
                          
                          {/* 2D Evaluation Summary & Risk Flags */}
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
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {offer.productType.replace('_', ' ')}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {offer.regionType}
                          </span>
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
                            <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 2 }} title="Evaluation Confidence">
                              ({(offer.evaluationConfidence * 100).toFixed(0)}% conf)
                            </span>
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Price History */}
          {history.length > 0 && (
            <div>
              <h4 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={16} /> Recorded Price History
              </h4>
              <div style={{ maxHeight: 180, overflowY: 'auto', background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', padding: 12 }}>
                <table className="offers-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Store</th>
                      <th>Source</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(h => (
                      <tr key={h.id}>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {new Date(h.recordedAt).toLocaleDateString()} {new Date(h.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ fontSize: 13 }}>{h.merchantName}</td>
                        <td style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{h.sourceCode}</td>
                        <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 13 }}>€{h.priceEur.toFixed(2)}</td>
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
