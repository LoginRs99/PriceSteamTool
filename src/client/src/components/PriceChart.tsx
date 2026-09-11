import React, { useState, useMemo, useRef } from 'react';
import type { PriceChartData, PriceChartPoint } from '../types.js';

interface PriceChartProps {
  data: PriceChartData;
}

type TimeframeOption = '1M' | '3M' | '6M' | '1Y' | 'ALL';

export const PriceChart: React.FC<PriceChartProps> = ({ data }) => {
  const [timeframe, setTimeframe] = useState<TimeframeOption>('ALL');
  const [hoveredPoint, setHoveredPoint] = useState<{ point: PriceChartPoint; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const { points: rawPoints, basePriceEur, historicalLowEur, typicalSaleMedianEur } = data;

  // Filter points based on timeframe
  const points = useMemo(() => {
    if (!rawPoints || rawPoints.length === 0) return [];
    if (timeframe === 'ALL') return rawPoints;

    const now = Date.now();
    const daysMap: Record<Exclude<TimeframeOption, 'ALL'>, number> = {
      '1M': 30,
      '3M': 90,
      '6M': 180,
      '1Y': 365
    };
    const cutoff = now - daysMap[timeframe] * 24 * 60 * 60 * 1000;
    const filtered = rawPoints.filter(p => new Date(p.timestamp).getTime() >= cutoff);

    // If filtered points is empty or only 1, include the point right before cutoff as anchor if available
    if (filtered.length < 2 && rawPoints.length >= 2) {
      return rawPoints.slice(-Math.max(filtered.length, 2));
    }
    return filtered;
  }, [rawPoints, timeframe]);

  if (!rawPoints || rawPoints.length < 2) {
    return (
      <div className="price-chart-empty">
        <p>Price tracking initialized. Timeline history graph will develop with subsequent sync observations.</p>
        {rawPoints && rawPoints.length === 1 && (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
            Latest recorded price: <strong>€{rawPoints[0].priceEur.toFixed(2)}</strong> ({rawPoints[0].merchantName})
          </div>
        )}
      </div>
    );
  }

  // Active min/max based on visible points
  const activeMinPrice = points.length > 0 ? Math.min(...points.map(p => p.priceEur)) : data.minPrice;
  const activeMaxPrice = points.length > 0 ? Math.max(...points.map(p => p.priceEur)) : data.maxPrice;

  // Chart dimensions & padding
  const width = 680;
  const height = 240;
  const padLeft = 55;
  const padRight = 20;
  const padTop = 25;
  const padBottom = 35;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Y-axis scaling: ensure headroom above max and cushion below min
  const yMin = Math.max(0, Math.floor(Math.min(activeMinPrice, historicalLowEur ?? activeMinPrice) * 0.85));
  const yMax = Math.ceil(Math.max(activeMaxPrice, basePriceEur ?? activeMaxPrice) * 1.08);
  const yRange = yMax - yMin || 1;

  // X-axis scaling: time-based
  const firstTime = points.length > 0 ? new Date(points[0].timestamp).getTime() : Date.now();
  const lastTime = points.length > 0 ? new Date(points[points.length - 1].timestamp).getTime() : Date.now();
  const timeSpan = lastTime - firstTime || 1;

  const getX = (timestamp: string) => {
    const t = new Date(timestamp).getTime();
    return padLeft + ((t - firstTime) / timeSpan) * chartW;
  };

  const getY = (price: number) => {
    return padTop + chartH - ((price - yMin) / yRange) * chartH;
  };

  // Generate SVG path for stepped price series
  let pathD = '';
  let areaD = '';

  points.forEach((p, idx) => {
    const x = getX(p.timestamp);
    const y = getY(p.priceEur);

    if (idx === 0) {
      pathD += `M ${x} ${y}`;
      areaD += `M ${x} ${padTop + chartH} L ${x} ${y}`;
    } else {
      const prevX = getX(points[idx - 1].timestamp);
      const prevY = getY(points[idx - 1].priceEur);
      // Stepped connection: keep previous price until time of new point
      pathD += ` L ${x} ${prevY} L ${x} ${y}`;
      areaD += ` L ${x} ${prevY} L ${x} ${y}`;
    }
  });

  if (points.length > 0) {
    const lastPointX = getX(points[points.length - 1].timestamp);
    areaD += ` L ${lastPointX} ${padTop + chartH} Z`;
  }

  // Y-axis ticks
  const yTicks = [
    yMin,
    Number((yMin + yRange * 0.33).toFixed(2)),
    Number((yMin + yRange * 0.66).toFixed(2)),
    yMax
  ];

  const timeframes: TimeframeOption[] = ['1M', '3M', '6M', '1Y', 'ALL'];

  return (
    <div className="price-chart-container">
      <div className="price-chart-header">
        <span className="price-chart-title">Price History Timeline</span>
        
        <div className="price-chart-controls">
          <div className="timeframe-selector" role="group" aria-label="Select chart timeframe">
            {timeframes.map(tf => (
              <button
                key={tf}
                type="button"
                className={`timeframe-btn ${timeframe === tf ? 'active' : ''}`}
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="price-chart-legend">
            {basePriceEur && (
              <span className="legend-item msrp">
                <span className="legend-line msrp-line"></span> Steam MSRP (€{basePriceEur.toFixed(2)})
              </span>
            )}
            {typicalSaleMedianEur && (
              <span className="legend-item typical">
                <span className="legend-line typical-line"></span> Typical Sale (€{typicalSaleMedianEur.toFixed(2)})
              </span>
            )}
            {historicalLowEur !== undefined && (
              <span className="legend-item atl">
                <span className="legend-line atl-line"></span> ATL (€{historicalLowEur.toFixed(2)})
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="price-chart-svg-wrap">
        <svg 
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`} 
          className="price-chart-svg"
          onMouseLeave={() => setHoveredPoint(null)}
        >
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--down)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--down)" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines & Y-axis labels */}
          {yTicks.map(tVal => {
            const y = getY(tVal);
            return (
              <g key={tVal}>
                <line 
                  x1={padLeft} 
                  y1={y} 
                  x2={width - padRight} 
                  y2={y} 
                  stroke="var(--line)" 
                  strokeDasharray="2 2"
                />
                <text 
                  x={padLeft - 8} 
                  y={y + 4} 
                  textAnchor="end" 
                  fill="var(--dim)" 
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                >
                  €{tVal.toFixed(0)}
                </text>
              </g>
            );
          })}

          {/* Baseline: Steam MSRP */}
          {basePriceEur && getY(basePriceEur) >= padTop && getY(basePriceEur) <= padTop + chartH && (
            <line
              x1={padLeft}
              y1={getY(basePriceEur)}
              x2={width - padRight}
              y2={getY(basePriceEur)}
              stroke="var(--dim-2)"
              strokeDasharray="4 4"
              strokeWidth="1.2"
            />
          )}

          {/* Baseline: Typical Sale Median */}
          {typicalSaleMedianEur && getY(typicalSaleMedianEur) >= padTop && getY(typicalSaleMedianEur) <= padTop + chartH && (
            <line
              x1={padLeft}
              y1={getY(typicalSaleMedianEur)}
              x2={width - padRight}
              y2={getY(typicalSaleMedianEur)}
              stroke="var(--accent-blue)"
              strokeDasharray="3 3"
              strokeWidth="1.2"
              strokeOpacity="0.6"
            />
          )}

          {/* Baseline: Confirmed All-Time Low */}
          {historicalLowEur !== undefined && getY(historicalLowEur) >= padTop && getY(historicalLowEur) <= padTop + chartH && (
            <line
              x1={padLeft}
              y1={getY(historicalLowEur)}
              x2={width - padRight}
              y2={getY(historicalLowEur)}
              stroke="var(--signal)"
              strokeDasharray="4 4"
              strokeWidth="1.2"
              strokeOpacity="0.7"
            />
          )}

          {/* Area fill */}
          <path d={areaD} fill="url(#priceGradient)" />

          {/* Price line */}
          <path d={pathD} fill="none" stroke="var(--down)" strokeWidth="2.2" strokeLinejoin="round" />

          {/* Interactive point markers */}
          {points.map((p, idx) => {
            const cx = getX(p.timestamp);
            const cy = getY(p.priceEur);
            const isHovered = hoveredPoint?.point === p;
            const isKeyDrop = p.priceEvent === 'NEW_HISTORICAL_LOW' || p.priceEvent === 'MAJOR_DROP' || p.priceEvent === 'EXTREME_DROP';

            return (
              <g 
                key={idx}
                onMouseEnter={() => setHoveredPoint({ point: p, x: cx, y: cy })}
                style={{ cursor: 'pointer' }}
              >
                {/* Invisible larger hit circle for easy hover */}
                <circle cx={cx} cy={cy} r={12} fill="transparent" />

                {/* Visible dot */}
                <circle 
                  cx={cx} 
                  cy={cy} 
                  r={isHovered ? 5 : isKeyDrop ? 4 : 2.5} 
                  fill={isKeyDrop ? 'var(--signal)' : 'var(--down)'}
                  stroke="var(--surface)"
                  strokeWidth="1.5"
                />
              </g>
            );
          })}

          {/* X-axis date labels */}
          <text 
            x={padLeft} 
            y={height - 10} 
            fill="var(--dim)" 
            fontSize="10"
            fontFamily="var(--font-mono)"
          >
            {new Date(points[0].timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })}
          </text>

          <text 
            x={width - padRight} 
            y={height - 10} 
            textAnchor="end"
            fill="var(--dim)" 
            fontSize="10"
            fontFamily="var(--font-mono)"
          >
            {new Date(points[points.length - 1].timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })}
          </text>
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoveredPoint && (() => {
          let tooltipStyle: React.CSSProperties = {
            left: `${(hoveredPoint.x / width) * 100}%`,
            top: `${(hoveredPoint.y / height) * 100}%`
          };

          if (svgRef.current) {
            const svgRect = svgRef.current.getBoundingClientRect();
            const wrapRect = svgRef.current.parentElement?.getBoundingClientRect() || svgRect;
            if (svgRect.width > 0 && svgRect.height > 0) {
              const left = (svgRect.left - wrapRect.left) + (hoveredPoint.x / width) * svgRect.width;
              const top = (svgRect.top - wrapRect.top) + (hoveredPoint.y / height) * svgRect.height;
              tooltipStyle = { left: `${left}px`, top: `${top}px` };
            }
          }

          return (
            <div 
              className="price-chart-tooltip"
              style={tooltipStyle}
            >
              <div className="tooltip-date">
                {new Date(hoveredPoint.point.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              <div className="tooltip-price">
                €{hoveredPoint.point.priceEur.toFixed(2)}
                {hoveredPoint.point.discountPercent > 0 && (
                  <span className="tooltip-discount"> -{hoveredPoint.point.discountPercent}%</span>
                )}
              </div>
              <div className="tooltip-merchant">
                {hoveredPoint.point.merchantName} {hoveredPoint.point.isOfficial && '• Official'}
              </div>
              {hoveredPoint.point.dealScore !== undefined && hoveredPoint.point.dealScore > 0 && (
                <div className="tooltip-score">
                  Deal Score: {hoveredPoint.point.dealScore}/100
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
};
