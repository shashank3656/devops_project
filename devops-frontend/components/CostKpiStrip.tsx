import Link from 'next/link';
import CostUnknown from './CostUnknown';
import type { CostUnknownReason } from '../lib/cost';

export type CostKpi = {
  label: string;
  value: string;
  hint?: string;
  tone?: 'billed' | 'unknown' | 'stale' | 'k8s' | 'wait';
  href?: string;
  unknown?: CostUnknownReason | null;
  importHref?: string;
};

export default function CostKpiStrip({ items, canOperate }: { items: CostKpi[]; canOperate?: boolean }) {
  return (
    <section className="cost-kpi" aria-label="Cost snapshot">
      {items.map((item) => {
        const inner = (
          <>
            <span className="cost-kpi__label">{item.label}</span>
            <strong className="cost-kpi__value">
              {item.unknown
                ? <CostUnknown reason={item.unknown} href={item.importHref} canOperate={canOperate} />
                : item.value}
            </strong>
            {item.hint ? <span className="cost-kpi__hint">{item.hint}</span> : null}
          </>
        );
        const className = `cost-kpi__tile cost-kpi__tile--${item.tone || 'unknown'}${item.href && !item.unknown ? ' is-link' : ''}`;
        if (item.href && !item.unknown) {
          return <Link key={item.label} href={item.href} className={className}>{inner}</Link>;
        }
        return <article key={item.label} className={className}>{inner}</article>;
      })}
    </section>
  );
}
