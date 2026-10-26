import Link from 'next/link';
import CostUnknown from './CostUnknown';
import type { CostUnknownReason } from '../lib/cost';

export type CostScorecardVisual = 'trend' | 'range' | 'progress' | 'count';

export type CostScorecardItem = {
  label: string;
  value: string;
  comparison?: string;
  comparisonLabel?: string;
  hint?: string;
  estimate?: boolean;
  sparkline?: number[];
  href?: string;
  unknown?: CostUnknownReason | null;
  meaning?: 'spend' | 'savings' | 'risk' | 'neutral';
  visual?: CostScorecardVisual;
  rangeLow?: string;
  rangeHigh?: string;
  progress?: number;
  countLabel?: string;
};

function Spark({ values }: { values: number[] }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
    const y = 28 - (Math.max(value, 0) / max) * 24;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg className="cost-score__spark" viewBox="0 0 100 32" aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Visual({ item }: { item: CostScorecardItem }) {
  if (item.visual === 'trend' && item.sparkline?.length) {
    return <Spark values={item.sparkline} />;
  }
  if (item.visual === 'range' && (item.rangeLow || item.rangeHigh)) {
    return (
      <span className="cost-score__range" aria-label={`Forecast range ${item.rangeLow || ''} to ${item.rangeHigh || ''}`}>
        <span>{item.rangeLow}</span>
        <span className="cost-score__range-bar" />
        <span>{item.rangeHigh}</span>
      </span>
    );
  }
  if (item.visual === 'progress' && typeof item.progress === 'number') {
    const width = Math.max(0, Math.min(100, item.progress));
    return (
      <span className="cost-score__meter" aria-label={`Budget used ${width}%`}>
        <span className="cost-score__meter-fill" style={{ width: `${width}%` }} />
      </span>
    );
  }
  if (item.visual === 'count' && item.countLabel) {
    return <span className="cost-score__count">{item.countLabel}</span>;
  }
  if (item.sparkline?.length) return <Spark values={item.sparkline} />;
  return null;
}

export default function CostScorecard({
  items,
  canOperate,
}: {
  items: CostScorecardItem[];
  canOperate?: boolean;
}) {
  return (
    <section className="cost-score" aria-label="Cost snapshot">
      {items.map((item) => {
        const body = (
          <>
            <span className="cost-score__label">{item.label}</span>
            <strong className="cost-score__value">
              {item.unknown
                ? <CostUnknown reason={item.unknown} canOperate={canOperate} />
                : item.value}
            </strong>
            {item.comparison || item.comparisonLabel ? (
              <span className="cost-score__compare">
                {item.comparisonLabel ? `${item.comparisonLabel}: ` : ''}
                {item.comparison || 'Unknown'}
              </span>
            ) : null}
            {item.estimate ? <span className="cost-score__badge">Estimate</span> : null}
            {item.hint ? <span className="cost-score__hint">{item.hint}</span> : null}
            <Visual item={item} />
          </>
        );
        const className = `cost-score__card${item.href && !item.unknown ? ' is-link' : ''}`;
        if (item.href && !item.unknown) {
          return <Link key={item.label} href={item.href} className={className}>{body}</Link>;
        }
        return <article key={item.label} className={className}>{body}</article>;
      })}
    </section>
  );
}
