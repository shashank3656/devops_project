import Link from 'next/link';
import CostUnknown from './CostUnknown';
import type { CostUnknownReason } from '../lib/cost';

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
              <span className={`cost-score__compare cost-score__compare--${item.meaning || 'neutral'}`}>
                {item.comparisonLabel ? `${item.comparisonLabel}: ` : ''}
                {item.comparison || 'Unknown'}
              </span>
            ) : null}
            {item.estimate ? <span className="cost-score__badge">Estimate</span> : null}
            {item.hint ? <span className="cost-score__hint">{item.hint}</span> : null}
            {item.sparkline?.length ? <Spark values={item.sparkline} /> : null}
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
