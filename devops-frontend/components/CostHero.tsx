import Link from 'next/link';
import CostUnknown from './CostUnknown';
import type { CostKpi } from './CostKpiStrip';
import type { CostUnknownReason } from '../lib/cost';

export default function CostHero({
  bill,
  hint,
  tone = 'unknown',
  billReason,
  importHref,
  canOperate,
  stats,
}: {
  bill: string;
  hint: string;
  tone?: CostKpi['tone'];
  billReason?: CostUnknownReason | null;
  importHref?: string;
  canOperate?: boolean;
  stats: CostKpi[];
}) {
  return (
    <section className={`cost-hero cost-hero--${tone}`} aria-label="Operating bill">
      <div className="cost-hero__bill">
        <span className="cost-hero__label">Operating bill</span>
        <strong className="cost-hero__value">
          {billReason ? <CostUnknown reason={billReason} href={importHref} canOperate={canOperate} /> : bill}
        </strong>
        <span className="cost-hero__hint">{hint}</span>
      </div>
      <dl className="cost-hero__stats">
        {stats.map((item) => {
          const body = (
            <>
              <dt>{item.label}</dt>
              <dd>
                {item.unknown
                  ? <CostUnknown reason={item.unknown} href={item.importHref || importHref} canOperate={canOperate} />
                  : item.value}
              </dd>
              {item.hint ? <span>{item.hint}</span> : null}
            </>
          );
          if (item.href && !item.unknown) {
            return (
              <Link key={item.label} href={item.href} className={`cost-hero__stat cost-hero__stat--${item.tone || 'unknown'} is-link`}>
                {body}
              </Link>
            );
          }
          return (
            <div key={item.label} className={`cost-hero__stat cost-hero__stat--${item.tone || 'unknown'}`}>
              {body}
            </div>
          );
        })}
      </dl>
    </section>
  );
}
