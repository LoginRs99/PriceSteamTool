import React, { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ onClose }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const shortcutGroups = [
    {
      title: 'Navigation & Search',
      items: [
        { key: '/', desc: 'Focus wishlist search bar' },
        { key: 'j / ↓', desc: 'Next game in detail modal' },
        { key: 'k / ↑', desc: 'Previous game in detail modal' },
        { key: 'Esc', desc: 'Close any active modal or flyout' }
      ]
    },
    {
      title: 'Views & Actions',
      items: [
        { key: '1 – 5', desc: 'Switch tabs (Wishlist, Free, Best Deals, Safety, Savings)' },
        { key: 'r', desc: 'Open Sync Wishlist & Deals dialog' },
        { key: '?', desc: 'Toggle this keyboard shortcuts cheat sheet' }
      ]
    }
  ];

  return (
    <div 
      className="modal-overlay" 
      onClick={onClose} 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="shortcuts-modal-title"
    >
      <div 
        className="modal-content" 
        onClick={e => e.stopPropagation()} 
        style={{ maxWidth: 480, padding: 0, overflow: 'hidden' }}
      >
        <div className="modal-header" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Keyboard size={20} color="var(--accent-blue)" />
            <h2 id="shortcuts-modal-title" style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>
              Keyboard Shortcuts
            </h2>
          </div>
          <button 
            type="button" 
            className="icon-button" 
            onClick={onClose} 
            aria-label="Close shortcuts modal"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {shortcutGroups.map((group, gIdx) => (
            <div key={gIdx}>
              <div style={{ 
                fontSize: 11, 
                textTransform: 'uppercase', 
                letterSpacing: 0.8, 
                fontWeight: 700, 
                color: 'var(--text-muted)', 
                marginBottom: 10 
              }}>
                {group.title}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {group.items.map((item, iIdx) => (
                  <div 
                    key={iIdx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      background: 'var(--bg-surface-elevated)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 13
                    }}
                  >
                    <span style={{ color: 'var(--text-secondary)' }}>{item.desc}</span>
                    <kbd style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      fontWeight: 700,
                      background: 'var(--bg-surface)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
                      padding: '2px 8px',
                      borderRadius: 4
                    }}>
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
