import React from 'react';
import type { Game } from '../types.js';

interface SparklineProps {
  points?: number[];
  game?: Game;
  width?: number | string;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const Sparkline: React.FC<SparklineProps> = ({
  points,
  game,
  width = 150,
  height = 28,
  className = '',
  style
}) => {
  // Derive points from game anchors if points array not directly supplied
  const rawPoints = React.useMemo(() => {
    if (points && points.length > 0) return points;
    if (!game) return [10, 10];

    const pts: number[] = [];
    if (game.basePriceEur !== undefined) pts.push(game.basePriceEur);
    if (game.typicalSaleMedianEur !== undefined) pts.push(game.typicalSaleMedianEur);
    if (game.low1yEur !== undefined && game.low1yEur !== game.typicalSaleMedianEur) pts.push(game.low1yEur);
    if (game.low90dEur !== undefined && game.low90dEur !== game.bestPriceEur) pts.push(game.low90dEur);
    if (game.bestPriceEur !== undefined) pts.push(game.bestPriceEur);

    if (pts.length === 0) return [10, 10];
    if (pts.length === 1) return [pts[0], pts[0]];
    return pts;
  }, [points, game]);

  const viewBoxW = 150;
  const viewBoxH = height;
  const padX = 6;
  const padY = 4;

  const { pathData, strokeColor, lastPoint } = React.useMemo(() => {
    const pCount = rawPoints.length;
    const minVal = Math.min(...rawPoints);
    const maxVal = Math.max(...rawPoints);
    const firstVal = rawPoints[0];
    const lastVal = rawPoints[pCount - 1];

    // Determine direction color: down = --down (good), up = --up (bad), flat = --dim
    let stroke = 'var(--dim)';
    if (lastVal < firstVal * 0.99) {
      stroke = 'var(--down)';
    } else if (lastVal > firstVal * 1.01) {
      stroke = 'var(--up)';
    }

    const usableW = viewBoxW - padX * 2;
    const usableH = viewBoxH - padY * 2;

    const coords = rawPoints.map((val, idx) => {
      const x = pCount === 1 ? viewBoxW / 2 : padX + (idx / (pCount - 1)) * usableW;
      const y = maxVal === minVal ? viewBoxH / 2 : viewBoxH - padY - ((val - minVal) / (maxVal - minVal)) * usableH;
      return { x, y };
    });

    const ptsString = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const last = coords[coords.length - 1];

    return {
      pathData: ptsString,
      strokeColor: stroke,
      lastPoint: last
    };
  }, [rawPoints, viewBoxH]);

  return (
    <div className={`ticker-sparkline-container ${className}`} style={{ width, height, ...style }}>
      <svg
        viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        style={{ display: 'block', overflow: 'visible' }}
        aria-hidden="true"
      >
        <polyline
          points={pathData}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {lastPoint && (
          <circle
            cx={lastPoint.x}
            cy={lastPoint.y}
            r="2"
            fill={strokeColor}
          />
        )}
      </svg>
    </div>
  );
};

