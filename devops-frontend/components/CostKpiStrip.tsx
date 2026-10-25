export type CostKpi = {
  label: string;
  value: string;
  hint?: string;
  tone?: 'billed' | 'unknown' | 'stale' | 'k8s' | 'wait';
};

export default function CostKpiStrip({ items }: { items: CostKpi[] }) {
  return (
    <section className="cost-kpi" aria-label="Cost snapshot">
      {items.map((item) => (
        <article key={item.label} className={`cost-kpi__tile cost-kpi__tile--${item.tone || 'unknown'}`}>
          <span className="cost-kpi__label">{item.label}</span>
          <strong className="cost-kpi__value">{item.value}</strong>
          {item.hint ? <span className="cost-kpi__hint">{item.hint}</span> : null}
        </article>
      ))}
    </section>
  );
}
