import { useMemo } from 'react';

export interface PieChartSegment {
  label: string;
  value: number;
  color: string;
}

const RADIUS = 64;
const CX = 80;
const CY = 80;
const SIZE = 160;

function getPath(segment: PieChartSegment, startAngle: number, total: number): string {
  if (total <= 0 || segment.value <= 0) return '';
  const angle = (segment.value / total) * 2 * Math.PI;
  const endAngle = startAngle + angle;
  const x1 = CX + RADIUS * Math.cos(startAngle);
  const y1 = CY - RADIUS * Math.sin(startAngle);
  const x2 = CX + RADIUS * Math.cos(endAngle);
  const y2 = CY - RADIUS * Math.sin(endAngle);
  const largeArc = angle > Math.PI ? 1 : 0;
  return `M ${CX} ${CY} L ${x1} ${y1} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

interface PieChartProps {
  title: string;
  segments: PieChartSegment[];
  emptyMessage?: string;
}

export default function PieChart({ title, segments, emptyMessage = 'No data' }: PieChartProps) {
  const { total, paths } = useMemo(() => {
    const total = segments.reduce((s, seg) => s + seg.value, 0);
    let angle = -Math.PI / 2;
    const paths = segments.map((seg) => {
      const d = getPath(seg, angle, total);
      angle += (seg.value / total) * 2 * Math.PI;
      return d;
    });
    return { total, paths };
  }, [segments]);

  const hasData = total > 0;

  return (
    <div className="dashboard-pie-card">
      <h3 className="dashboard-pie-title">{title}</h3>
      <div className="dashboard-pie-wrap">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="dashboard-pie-svg">
          {hasData ? (
            segments.map((seg, i) => (
              <path
                key={seg.label}
                d={paths[i]}
                fill={seg.color}
                className="dashboard-pie-segment"
                style={{ transition: 'opacity 0.2s' }}
              />
            ))
          ) : (
            <circle cx={CX} cy={CY} r={RADIUS} fill="var(--color-bg)" stroke="var(--color-border)" strokeWidth="1" />
          )}
        </svg>
        {hasData && (
          <div className="dashboard-pie-legend">
            {segments.map((seg) => (
              <div key={seg.label} className="dashboard-pie-legend-item">
                <span className="dashboard-pie-legend-dot" style={{ background: seg.color }} />
                <span className="dashboard-pie-legend-label">{seg.label}</span>
                <span className="dashboard-pie-legend-value">{seg.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {!hasData && <p className="dashboard-pie-empty">{emptyMessage}</p>}
    </div>
  );
}
