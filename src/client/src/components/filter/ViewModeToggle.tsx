import React from 'react';
import type { ViewMode } from '../../types.js';
import { LayoutGrid, List, Table as TableIcon } from 'lucide-react';

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
        className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
        onClick={() => onViewModeChange('grid')}
        title="Grid View (Cards)"
        aria-label="Grid View (Cards)"
      >
        <LayoutGrid size={16} />
      </button>
      <button
        className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
        onClick={() => onViewModeChange('list')}
        title="Compact List View (Dense Rows)"
        aria-label="Compact List View (Dense Rows)"
      >
        <List size={16} />
      </button>
      <button
        className={`view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
        onClick={() => onViewModeChange('table')}
        title="Dense Table View (Data Table)"
        aria-label="Dense Table View (Data Table)"
      >
        <TableIcon size={16} />
      </button>
    </div>
  );
};
