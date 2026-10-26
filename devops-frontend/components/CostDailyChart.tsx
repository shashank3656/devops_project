import type { CostGraphBar } from '../lib/cost';

function money(display?: string) {
  const value = Number(String(display || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(value) ? value : 0;
}

function point(index: number, count: number, value: number, max: number) {
  const x = 48 + (count <= 1 ? 0 : (index / (count - 1)) * 312);
  const y = 118 - (max <= 0 ? 0 : (value / max) * 96);
  return `${x},${y}`;
}

export default function CostDailyChart({
  days,
  prior = [],
  emptyNote = 'Daily spend stays empty until a complete billed window exists.',
  currency = 'USD',
  caption = 'Daily spend · current period versus prior like-for-like window',
}: {
  days: CostGraphBar[];
  prior?: CostGraphBar[];
  emptyNote?: string;
  currency?: string;
  caption?: string;
}) {
  if (!days.length) {
    return <p className="cost-dash__empty">{emptyNote}</p>;
  }
  const currentValues = days.map((row) => money(row.display) || row.percent);
  const priorValues = prior.map((row) => money(row.display) || row.percent);
  const max = Math.max(...currentValues, ...priorValues, 1);
  const ticks = [...new Set([0, Math.round(max / 2), Math.round(max)])];
  const xLabels = days.filter((_, index) => index === 0 || index === days.length - 1 || index % 7 === 0);
  const currentLine = currentValues.map((value, index) => point(index, currentValues.length, value, max)).join(' ');
  const priorLine = priorValues.length
    ? priorValues.map((value, index) => point(index, currentValues.length, value, max)).join(' ')
    : '';

  return (
    <figure className="cost-chart">
      <svg viewBox="0 0 380 148" role="img" aria-label="Daily spend versus the prior period">
        {ticks.map((tick) => {
          const y = 118 - (tick / max) * 96;
          return (
            <g key={tick}>
              <line x1="48" x2="360" y1={y} y2={y} className="cost-chart__grid" />
              <text x="40" y={y + 4} className="cost-chart__axis" textAnchor="end">
                {currency === 'USD' ? `$${tick.toLocaleString()}` : `${tick}`}
              </text>
            </g>
          );
        })}
        {priorLine ? <polyline className="cost-chart__prior" points={priorLine} fill="none" /> : null}
        <polyline className="cost-chart__current" points={currentLine} fill="none" />
        {xLabels.map((row) => {
          const index = days.indexOf(row);
          const x = 48 + (days.length <= 1 ? 0 : (index / (days.length - 1)) * 312);
          return (
            <text key={row.date || row.label} x={x} y="138" className="cost-chart__axis" textAnchor="middle">
              {row.label}
            </text>
          );
        })}
      </svg>
      <figcaption className="cost-chart__caption">{caption}</figcaption>
    </figure>
  );
}
