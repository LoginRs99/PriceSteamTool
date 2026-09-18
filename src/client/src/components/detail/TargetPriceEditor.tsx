import React from 'react';
import { Check, Sparkles, Tag, Flame } from 'lucide-react';
import type { PriceIntelligenceResponse } from '../../types.js';
import { useCurrency } from '../../context/CurrencyContext.js';

interface TargetPriceEditorProps {
  currentTargetPrice?: number;
  targetPriceInput: string;
  savingTarget: boolean;
  targetSavedSuccess: boolean;
  intelligence?: PriceIntelligenceResponse;
  allTimeLowEur?: number;
  onInputChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
}

export const TargetPriceEditor: React.FC<TargetPriceEditorProps> = ({
  currentTargetPrice,
  targetPriceInput,
  savingTarget,
  targetSavedSuccess,
  intelligence,
  allTimeLowEur,
  onInputChange,
  onSave,
  onClear
}) => {
  const { currencyInfo, convertEurToLocal, formatPrice } = useCurrency();

  const typicalMedianEur = intelligence?.typicalSale?.medianPriceEur;
  const typicalQ1Eur = intelligence?.typicalSale?.q1PriceEur;
  const atlEur = intelligence?.periodLows?.allTimeLow?.priceEur ?? allTimeLowEur;

  // Compute preset values converted to the selected currency
  const presets: { label: string; eur: number; icon: React.ReactNode; color: string }[] = [];
  if (typicalMedianEur != null && typicalMedianEur > 0) {
    presets.push({
      label: 'Typical',
      eur: typicalMedianEur,
      icon: <Tag size={12} />,
      color: 'var(--accent-blue)'
    });
  }
  if (typicalQ1Eur != null && typicalQ1Eur > 0) {
    presets.push({
      label: 'Great (Q1)',
      eur: typicalQ1Eur,
      icon: <Sparkles size={12} />,
      color: '#06b6d4'
    });
  }
  if (atlEur != null && atlEur > 0) {
    presets.push({
      label: 'Record Low',
      eur: atlEur,
      icon: <Flame size={12} />,
      color: 'var(--signal)'
    });
  }

  const handleApplyPreset = (eurVal: number) => {
    const localVal = convertEurToLocal(eurVal);
    if (localVal != null) {
      onInputChange(currencyInfo.decimalPlaces === 0 ? Math.round(localVal).toString() : localVal.toFixed(currencyInfo.decimalPlaces));
    }
  };

  return (
    <div style={{
      background: 'rgba(56, 189, 248, 0.05)',
      border: '1px solid rgba(56, 189, 248, 0.18)',
      borderRadius: 'var(--radius-md)',
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }}>
      <div style={{
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
            {currencyInfo.isPrefix && (
              <span style={{ position: 'absolute', left: 10, fontSize: 13, color: 'var(--text-muted)', pointerEvents: 'none' }}>
                {currencyInfo.symbol}
              </span>
            )}
            <input
              type="number"
              step={currencyInfo.decimalPlaces === 0 ? "100" : "0.50"}
              min="0"
              placeholder={currencyInfo.decimalPlaces === 0 ? "e.g. 5000" : "e.g. 14.99"}
              value={targetPriceInput}
              onChange={(e) => onInputChange(e.target.value)}
              style={{
                width: currencyInfo.decimalPlaces === 0 ? 120 : 105,
                padding: currencyInfo.isPrefix ? '6px 10px 6px 24px' : '6px 28px 6px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface-elevated)',
                color: 'var(--text-primary)',
                fontSize: 13,
                fontFamily: 'var(--font-mono)'
              }}
            />
            {!currencyInfo.isPrefix && (
              <span style={{ position: 'absolute', right: 8, fontSize: 12, color: 'var(--text-muted)', pointerEvents: 'none' }}>
                {currencyInfo.symbol}
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onSave}
            disabled={savingTarget}
            style={{ padding: '6px 12px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            {targetSavedSuccess ? <Check size={14} color="#10b981" /> : <Sparkles size={14} />}
            <span>{savingTarget ? 'Saving...' : targetSavedSuccess ? 'Saved!' : 'Set Target'}</span>
          </button>
          {currentTargetPrice !== undefined && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClear}
              style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-muted)' }}
              title="Remove target price"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Smart Target Price Presets */}
      {presets.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingTop: 2 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Quick Presets:</span>
          {presets.map((p, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleApplyPreset(p.eur)}
              className="btn btn-outline"
              style={{
                padding: '3px 8px',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                borderColor: 'var(--border-subtle)',
                background: 'var(--bg-surface)'
              }}
              title={`Preset ${p.label}: ${formatPrice(p.eur)}`}
            >
              <span style={{ color: p.color, display: 'flex', alignItems: 'center' }}>{p.icon}</span>
              <span>{p.label}: <strong>{formatPrice(p.eur)}</strong></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
