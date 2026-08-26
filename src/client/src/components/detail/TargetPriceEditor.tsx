import React from 'react';
import { Check, Sparkles } from 'lucide-react';

interface TargetPriceEditorProps {
  currentTargetPrice?: number;
  targetPriceInput: string;
  savingTarget: boolean;
  targetSavedSuccess: boolean;
  onInputChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
}

export const TargetPriceEditor: React.FC<TargetPriceEditorProps> = ({
  currentTargetPrice,
  targetPriceInput,
  savingTarget,
  targetSavedSuccess,
  onInputChange,
  onSave,
  onClear
}) => {
  return (
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
            onChange={(e) => onInputChange(e.target.value)}
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
  );
};
