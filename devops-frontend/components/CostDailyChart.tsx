import type { CostGraphBar } from '../lib/cost';

export default function CostDailyChart({
  days,
  prior = [],
  emptyNote = 'Daily spend stays empty until a complete billed window exists.',
}: {
  days: CostGraphBar[];
  prior?: CostGraphBar[];
  emptyNote?: string;
}) {
  if (!days.length) {
    return <p className="cost-dash__empty">{emptyNote}</p>;
  }
  return (
    <div className="cost-days cost-days--compare" aria-label="Daily spend">
      {days.map((day, index) => {
        const priorPercent = prior[index]?.percent;
        return (
          <div key={day.date || day.label} className="cost-days__col" title={`${day.label} ${day.display}`}>
            <span className="cost-days__plot">
              {typeof priorPercent === 'number' ? (
                <span className="cost-days__bar cost-days__bar--prior" style={{ height: `${Math.max(priorPercent, 3)}%` }} />
              ) : null}
              <span className="cost-days__bar" style={{ height: `${Math.max(day.percent, 3)}%` }} />
            </span>
            <span className="cost-days__label">{(day.date || day.label).slice(-2)}</span>
          </div>
        );
      })}
    </div>
  );
}
