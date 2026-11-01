import React, { useState } from 'react';
import type { Offer } from '../../types.js';
import { isRecordDropEvent } from '../../utils/priceEvents.js';
import { 
  ShieldCheck, 
  AlertTriangle, 
  Copy, 
  Check,
  Clock
} from 'lucide-react';
import { useCurrency } from '../../context/CurrencyContext.js';

interface OffersTableProps {
  offers: Offer[];
  copiedVoucherId: string | null;
  onCopyVoucher: (offerId: string, voucherCode: string) => void;
  onRecordPurchase?: (offer: Offer) => void;
  recordedOfferId?: string | null;
}

export const OffersTable: React.FC<OffersTableProps> = ({
  offers,
  copiedVoucherId,
  onCopyVoucher,
  onRecordPurchase,
  recordedOfferId
}) => {
  const { formatPrice } = useCurrency();
  const [showExpired, setShowExpired] = useState(false);
  const [storeFilter, setStoreFilter] = useState<'ALL' | 'OFFICIAL' | 'KEYSHOP'>('ALL');

  // Filter by store type
  const filterByStore = (list: Offer[]) => {
    if (storeFilter === 'OFFICIAL') return list.filter(o => o.isOfficial);
    if (storeFilter === 'KEYSHOP') return list.filter(o => !o.isOfficial);
    return [...list];
  };

  const currentFilteredOffers = filterByStore(offers);
  const currentActive = currentFilteredOffers.filter(o => o.isValid !== false && o.isFresh !== false);
  const currentValid = currentFilteredOffers.filter(o => o.isValid !== false);
  const currentExpired = currentFilteredOffers.filter(o => o.isValid === false || o.isFresh === false);

  // If there are fresh active offers in the selected view, show them.
  // If none are strictly fresh, fallback to showing valid (though stale) offers so the user still sees prices.
  // Fallback to all offers if no valid offers exist. Both sections strictly sorted by price ascending.
  const displayActive = (
    currentActive.length > 0
      ? currentActive
      : currentValid.length > 0
        ? currentValid
        : currentFilteredOffers
  ).slice().sort((a, b) => a.priceEur - b.priceEur);

  const displayExpired = (
    currentActive.length > 0
      ? currentExpired
      : currentValid.length > 0
        ? currentFilteredOffers.filter(o => o.isValid === false)
        : []
  ).slice().sort((a, b) => a.priceEur - b.priceEur);

  const bestOffer = displayActive[0] || offers.find(o => o.isValid !== false) || offers[0];
  const lowestPrice = bestOffer ? bestOffer.priceEur : 0;

  const renderOfferRows = (offerList: Offer[], isExpiredSection = false) => {
    return offerList.map(offer => {
      const score = offer.dealScore ?? 0;
      const tier = offer.dealTier || 'Fair';
      const color = 
        tier === 'Exceptional' ? 'var(--accent-purple)' : 
        tier === 'Great' ? 'var(--down)' : 
        tier === 'Good' ? 'var(--accent-blue)' :
        'var(--dim)';

      const scoreBg = 
        tier === 'Exceptional' ? 'rgba(167, 139, 250, 0.15)' : 
        tier === 'Great' ? 'var(--down-dim)' : 
        tier === 'Good' ? 'rgba(56, 189, 248, 0.15)' :
        'rgba(107, 114, 128, 0.15)';

      // Badges must be relative to the actual lowest market price, not evaluated in isolation
      const isCompetitivePrice = lowestPrice > 0 && offer.priceEur <= lowestPrice * 1.03;
      const isAtAtl = isRecordDropEvent(offer.priceEvent) && (Boolean(offer.isBestDeal) || isCompetitivePrice);
      const isMegaDrop = offer.priceEvent === 'EXTREME_DROP' && (Boolean(offer.isBestDeal) || isCompetitivePrice);
      const isMajorDrop = offer.priceEvent === 'MAJOR_DROP' && (Boolean(offer.isBestDeal) || isCompetitivePrice);

      const readableAnomalyReason = offer.pricingErrorReason
        ? (offer.pricingErrorReason.includes('High Risk') || offer.pricingErrorReason.includes('Unconfirmed') 
            ? 'Unverified outlier price (Flagged in Data Safety)' 
            : offer.pricingErrorReason)
        : 'Flagged outlier price';

      return (
        <tr key={offer.id} style={isExpiredSection ? { opacity: 0.78 } : undefined}>
          <td>
            <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              {offer.merchantName}
              {offer.isOfficial ? (
                <span title="Official Authorized Retailer — guaranteed final price, VAT & fees included" style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <ShieldCheck size={14} color="var(--down)" />
                </span>
              ) : (
                <span 
                  title="Keyshop marketplace listing price (Excludes payment processing fees, service fees, or checkout VAT)" 
                  style={{ 
                    fontSize: 10, 
                    fontWeight: 700, 
                    padding: '1px 5px', 
                    borderRadius: 3, 
                    background: 'rgba(234, 179, 8, 0.12)', 
                    color: '#eab308', 
                    border: '1px solid rgba(234, 179, 8, 0.3)',
                    letterSpacing: '0.02em'
                  }}
                >
                  Keyshop
                </span>
              )}
            </div>
            
            {/* Evaluation Flags */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {isAtAtl && (
                <span className="ticker-flag ticker-flag-atl" style={{ fontSize: 10, padding: '1px 5px' }}>
                  🏆 ALL-TIME LOW
                </span>
              )}
              {isMegaDrop && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', background: 'rgba(167, 139, 250, 0.18)', color: 'var(--accent-purple)', borderRadius: 3 }}>
                  🔥 MEGA DEAL
                </span>
              )}
              {isMajorDrop && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', background: 'var(--down-dim)', color: 'var(--down)', borderRadius: 3 }}>
                  ✨ MAJOR DROP
                </span>
              )}
              {Boolean(offer.isBestDeal) && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', background: 'rgba(56, 189, 248, 0.15)', color: 'var(--accent-blue)', borderRadius: 3 }}>
                  ⭐ BEST OFFER
                </span>
              )}
              {offer.isLikelyPricingError && (
                <span className="ticker-flag ticker-flag-up" style={{ fontSize: 10, padding: '1px 5px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <AlertTriangle size={10} /> HIGH RISK
                </span>
              )}
            </div>

            {offer.isLikelyPricingError && (
              <span style={{ fontSize: 11, color: 'var(--up)', display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                <AlertTriangle size={11} /> {readableAnomalyReason}
              </span>
            )}
          </td>
                    <td>
                      {offer.isLikelyPricingError ? (
                        <span 
                          className="ticker-num"
                          title={offer.pricingErrorReason || '⚡ Pricing Anomaly / Glitch Deal'}
                          style={{ 
                            fontSize: 11, 
                            fontWeight: 800, 
                            padding: '2px 8px', 
                            borderRadius: 'var(--radius-sm)', 
                            background: 'rgba(239, 68, 68, 0.2)', 
                            color: '#f87171',
                            border: '1px solid rgba(239, 68, 68, 0.45)',
                            display: 'inline-block'
                          }}
                        >
                          ⚡ GLITCH
                        </span>
                      ) : score > 0 ? (
                        <span 
                          className="ticker-num"
                          style={{ 
                            fontSize: 11, 
                            fontWeight: 800, 
                            padding: '2px 8px', 
                            borderRadius: 'var(--radius-sm)', 
                            background: scoreBg, 
                            color: color,
                            border: `1px solid ${color}44`,
                            display: 'inline-block'
                          }}
                        >
                          {score} • {tier === 'Exceptional' ? 'Mega Deal' : tier === 'Great' ? 'Great Deal' : tier === 'Good' ? 'Good Deal' : tier}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--dim)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: 12, color: 'var(--dim)' }}>
                        {offer.productType?.replace('_', ' ') || 'Game'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--dim-2)' }}>
                        {offer.regionType}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="ticker-num">{formatPrice(offer.priceEur)}</span>
                        {!offer.isOfficial && (
                          <span 
                            title="Base marketplace listing price. Final total at checkout may include payment processing fees or platform service fees."
                            style={{ 
                              fontSize: 10, 
                              color: 'var(--dim-2)', 
                              fontWeight: 500, 
                              cursor: 'help' 
                            }}
                          >
                            +fees
                          </span>
                        )}
                        {offer.isFresh === false && (
                          <span 
                            className="stale-badge"
                            style={{ 
                              fontSize: 10, 
                              fontWeight: 700, 
                              padding: '1px 4px', 
                              borderRadius: 3, 
                              background: 'rgba(148, 163, 184, 0.18)', 
                              color: 'var(--dim)',
                              border: '1px solid var(--line)' 
                            }}
                            title="Stale fallback price (last observed >72h ago)"
                          >
                            Stale
                          </span>
                        )}
                      </div>
                      {(offer.discountPercent || 0) > 0 && (
                        <span className="ticker-num" style={{ fontSize: 11, color: 'var(--down)' }}>
                          -{offer.discountPercent}%
                        </span>
                      )}
                      {offer.rawCurrency && offer.rawCurrency !== 'EUR' && offer.rawPrice && (
                        <div className="ticker-num" style={{ fontSize: 10, color: 'var(--dim-2)' }}>
                          {offer.rawPrice.toFixed(2)} {offer.rawCurrency}
                        </div>
                      )}
                      {offer.voucherCode && (
                        <div style={{ marginTop: 4 }}>
                          <button
                            type="button"
                            onClick={() => onCopyVoucher(offer.id, offer.voucherCode!)}
                            className="voucher-copy-btn"
                            title="Click to copy voucher code to clipboard"
                            style={{
                              background: copiedVoucherId === offer.id ? 'rgba(16, 185, 129, 0.25)' : 'rgba(16, 185, 129, 0.12)',
                              border: '1px dashed #10b981',
                              color: '#10b981',
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4
                            }}
                          >
                            {copiedVoucherId === offer.id ? (
                              <>
                                <Check size={11} />
                                <span>COPIED!</span>
                              </>
                            ) : (
                              <>
                                <Copy size={11} />
                                <span>{offer.voucherCode}</span>
                              </>
                            )}
                          </button>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <a
                          href={offer.dealUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                        >
                          Buy
                        </a>
                        {onRecordPurchase && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{
                              padding: '4px 8px',
                              fontSize: 11,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              color: recordedOfferId === offer.id ? '#10b981' : '#34d399',
                              borderColor: 'rgba(16, 185, 129, 0.3)'
                            }}
                            onClick={() => onRecordPurchase(offer)}
                            title="I bought it at this price (save to purchase and savings log)"
                          >
                            <Check size={11} />
                            <span>{recordedOfferId === offer.id ? 'Bought!' : 'I Bought It'}</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
        );
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h4 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
            Available Offers ({displayActive.length})
          </h4>
          
          <div className="timeframe-selector" style={{ fontSize: 11 }}>
            <button
              type="button"
              className={`timeframe-btn ${storeFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setStoreFilter('ALL')}
            >
              All
            </button>
            <button
              type="button"
              className={`timeframe-btn ${storeFilter === 'OFFICIAL' ? 'active' : ''}`}
              onClick={() => setStoreFilter('OFFICIAL')}
            >
              Official
            </button>
            <button
              type="button"
              className={`timeframe-btn ${storeFilter === 'KEYSHOP' ? 'active' : ''}`}
              onClick={() => setStoreFilter('KEYSHOP')}
            >
              Keyshops
            </button>
          </div>
        </div>

        {displayExpired.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowExpired(!showExpired)}
            style={{ fontSize: 11, padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
            title="Toggle previous prices from earlier syncs that are no longer available in stores"
          >
            <Clock size={12} />
            <span>{showExpired ? 'Hide Expired' : `Show Expired (${displayExpired.length})`}</span>
          </button>
        )}
      </div>

      {displayActive.length === 0 ? (
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
              {renderOfferRows(displayActive, false)}
            </tbody>
          </table>
        </div>
      )}

      {/* Collapsible Section for Expired / Out-of-Stock Historical Prices */}
      {showExpired && displayExpired.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px dashed var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Clock size={14} color="var(--dim)" />
            <h5 style={{ fontSize: 13, fontWeight: 700, color: 'var(--dim)', margin: 0 }}>
              Expired / Out-of-Stock Prices ({displayExpired.length})
            </h5>
          </div>
          <p style={{ fontSize: 12, color: 'var(--dim-2)', marginBottom: 10 }}>
            These prices were observed on earlier syncs, but are no longer active or in stock in stores.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="offers-table" style={{ opacity: 0.85 }}>
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
                {renderOfferRows(displayExpired, true)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
