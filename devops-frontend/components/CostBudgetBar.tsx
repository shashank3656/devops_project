import { CostBudgetStatus, budgetAlertLabel, budgetBarPercent } from '../lib/cost';

export default function CostBudgetBar({ row }: { row: CostBudgetStatus }) {
  const percent = budgetBarPercent(row);
  const remainingUnknown = !row.remaining || row.remaining.display === 'Unknown';
  return (
    <article className={`cost-budget cost-budget--${(row.alert || 'unknown').toLowerCase()}`}>
      <span className="cost-kpi__label">{row.name}</span>
      <strong className="cost-kpi__value">{row.remaining?.display || 'Unknown'}</strong>
      <span className="cost-kpi__hint">
        Spent {row.spent?.display || 'Unknown'} · {budgetAlertLabel(row.alert)}
      </span>
      {percent === null || remainingUnknown ? (
        <div className="cost-budget__track is-unknown" aria-label="Remaining Unknown">
          <span className="cost-budget__unknown">Unknown</span>
        </div>
      ) : (
        <div className="cost-budget__track" aria-label={`${percent}% spent`}>
          <span className="cost-budget__fill" style={{ width: `${percent}%` }} />
        </div>
      )}
    </article>
  );
}
