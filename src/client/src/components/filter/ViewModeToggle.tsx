import React from 'react';
import type { ViewMode } from '../../types.js';
import { List, LayoutGrid } from 'lucide-react';

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export const ViewModeToggle: React.FC<ViewModeToggleProps> = ({
  viewMode,
  onViewModeChange
}) => {
  return (
    <div className="view-mode-group" role="group" aria-label="View Mode">
      <button
        className={`view-mode-btn ${viewMode === 'compact' ? 'active' : ''}`}
        onClick={() => onViewModeChange('compact')}
        title="Compact Ticker List (Dense Rows)"
        aria-label="Compact Ticker List (Dense Rows)"
      >
        <List size={16} />
      </button>
      <button
        className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
        onClick={() => onViewModeChange('grid')}
        title="Visual Grid (Poster Cards)"
        aria-label="Visual Grid (Poster Cards)"
      >
        <LayoutGrid size={16} />
      </button>
    </div>
  );
};
