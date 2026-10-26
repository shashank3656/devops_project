import Link from 'next/link';
import { CostGraphBar, costFamilyTone } from '../lib/cost';

function MixRing({ mix }: { mix: CostGraphBar[] }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg className="cost-ring" viewBox="0 0 120 120" role="img" aria-label="Service mix">
      <circle className="cost-ring__track" cx="60" cy="60" r={radius} />
      {mix.map((row) => {
        const length = (Math.max(row.percent, 0) / 100) * circumference;
        const circle = (
          <circle
            key={row.label}
            className={`cost-ring__arc cost-ring__arc--${costFamilyTone(row.label)}`}
            cx="60"
            cy="60"
            r={radius}
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={-offset}
          />
        );
        offset += length;
        return circle;
      })}
    </svg>
  );
}

export default function CostMixChart({
  mix,
  days,
  familyHref,
  emptyNote = 'Graph stays empty until a complete billed window exists.',
}: {
  mix: CostGraphBar[];
  days: CostGraphBar[];
  familyHref?: (family: string) => string;
  emptyNote?: string;
}) {
  return (
    <div className="cost-viz">
      <div className="cost-viz__mix">
        {mix.length ? <MixRing mix={mix} /> : null}
        {mix.length ? (
          <div className="cost-mix" aria-label="Service mix">
            {mix.map((row) => {
              const body = (
                <>
                  <span className="cost-mix__label">{row.label}</span>
                  <div className="cost-mix__track">
                    <span
                      className={`cost-mix__fill cost-mix__fill--${costFamilyTone(row.label)}`}
                      style={{ width: `${Math.max(row.percent, 0)}%` }}
                    />
                  </div>
                  <span className="cost-mix__value">{row.display}</span>
                </>
              );
              if (familyHref) {
                return (
                  <Link key={row.label} href={familyHref(row.label)} className="cost-mix__row is-link">
                    {body}
                  </Link>
                );
              }
              return <div key={row.label} className="cost-mix__row">{body}</div>;
            })}
          </div>
        ) : (
          <p className="cost-dash__empty">{emptyNote}</p>
        )}
      </div>
      {days.length ? (
        <div className="cost-days" aria-label="Daily spend">
          {days.map((day) => (
            <div key={day.date || day.label} className="cost-days__col" title={`${day.label} ${day.display}`}>
              <span className="cost-days__plot">
                <span className="cost-days__bar" style={{ height: `${Math.max(day.percent, 3)}%` }} />
              </span>
              <span className="cost-days__label">{(day.date || day.label).slice(-2)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
