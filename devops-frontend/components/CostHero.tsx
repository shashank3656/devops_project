import type { CostKpi } from './CostKpiStrip';

export default function CostHero({
  bill,
  hint,
  tone = 'unknown',
  stats,
}: {
  bill: string;
  hint: string;
  tone?: CostKpi['tone'];
  stats: CostKpi[];
}) {
  return (
    <section className={`cost-hero cost-hero--${tone}`} aria-label="Operating bill">
      <div className="cost-hero__bill">
        <span className="cost-hero__label">Operating bill</span>
        <strong className="cost-hero__value">{bill}</strong>
        <span className="cost-hero__hint">{hint}</span>
      </div>
      <dl className="cost-hero__stats">
        {stats.map((item) => (
          <div key={item.label} className={`cost-hero__stat cost-hero__stat--${item.tone || 'unknown'}`}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
            {item.hint ? <span>{item.hint}</span> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
