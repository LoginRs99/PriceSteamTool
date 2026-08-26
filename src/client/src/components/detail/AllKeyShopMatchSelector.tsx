import React from 'react';
import { Key, Search, RefreshCw, Check } from 'lucide-react';

interface AllKeyShopMatchSelectorProps {
  showAksSelector: boolean;
  loadingAksCandidates: boolean;
  savingAksOverride: boolean;
  aksOverrideSuccess: boolean;
  aksCandidates: { id: number; name: string; slug?: string }[];
  currentAksOverride: string | number | null;
  customAksInput: string;
  onToggleSelector: () => void;
  onApplyOverride: (override: string | number | null) => void;
  onCustomInputChange: (value: string) => void;
}

export const AllKeyShopMatchSelector: React.FC<AllKeyShopMatchSelectorProps> = ({
  showAksSelector,
  loadingAksCandidates,
  savingAksOverride,
  aksOverrideSuccess,
  aksCandidates,
  currentAksOverride,
  customAksInput,
  onToggleSelector,
  onApplyOverride,
  onCustomInputChange
}) => {
  return (
    <div style={{ background: 'var(--bg-surface-elevated)', borderRadius: 'var(--radius-md)', padding: 14, border: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Key size={16} color="#f59e0b" />
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>AllKeyShop Párosítás / Source Match</span>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {currentAksOverride 
                ? `Egyéni felülbírálás aktív: ${currentAksOverride}`
                : 'Automatikus egyeztetés aktív'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {aksOverrideSuccess && (
            <span style={{ fontSize: 12, color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
              <Check size={14} /> Frissítve!
            </span>
          )}
          <button
            type="button"
            onClick={onToggleSelector}
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Search size={13} />
            {showAksSelector ? 'Bezárás' : 'Jelöltek megtekintése / Módosítás'}
          </button>
        </div>
      </div>

      {showAksSelector && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
          {loadingAksCandidates ? (
            <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 12, color: 'var(--text-muted)' }}>
              <RefreshCw size={14} className="spin" style={{ display: 'inline', marginRight: 6 }} />
              Jelöltek keresése az AllKeyShop katalógusban...
            </div>
          ) : (
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
                Talált AllKeyShop jelöltek erre a játékra ({aksCandidates.length}):
              </span>
              {aksCandidates.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                  {aksCandidates.map((cand, idx) => {
                    const isSelected = currentAksOverride === cand.id || currentAksOverride === cand.slug;
                    return (
                      <div 
                        key={cand.id || idx}
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between', 
                          padding: '8px 12px', 
                          background: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-surface)', 
                          border: isSelected ? '1px solid #3b82f6' : '1px solid var(--border-subtle)', 
                          borderRadius: 6 
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {cand.name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            ID: {cand.id} {cand.slug ? `• ${cand.slug}` : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={savingAksOverride}
                          onClick={() => onApplyOverride(cand.slug || cand.id)}
                          className={isSelected ? "btn btn-primary" : "btn btn-secondary"}
                          style={{ fontSize: 11, padding: '4px 10px' }}
                        >
                          {isSelected ? '✓ Aktív' : 'Kiválasztás'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Nincs automatikus jelölt. Megadhatsz egyedi AllKeyShop linket alább:
                </div>
              )}

              {/* Custom URL or Slug Input */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Pl. https://www.allkeyshop.com/blog/buy-judas-cd-key-compare-prices-2/ vagy slug"
                  value={customAksInput}
                  onChange={e => onCustomInputChange(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 240,
                    padding: '6px 10px',
                    fontSize: 12,
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    color: 'var(--text-primary)'
                  }}
                />
                <button
                  type="button"
                  disabled={savingAksOverride || !customAksInput.trim()}
                  onClick={() => onApplyOverride(customAksInput.trim())}
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '6px 12px' }}
                >
                  {savingAksOverride ? 'Mentés...' : 'Mentés & Frissítés'}
                </button>
                {currentAksOverride && (
                  <button
                    type="button"
                    disabled={savingAksOverride}
                    onClick={() => {
                      onCustomInputChange('');
                      onApplyOverride(null);
                    }}
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '6px 12px', color: '#f87171' }}
                  >
                    Visszaállítás automatikusra
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
