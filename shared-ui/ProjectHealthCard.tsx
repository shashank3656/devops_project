import type { ReactNode } from 'react';
import { formatMoney } from './CostCheckCard';
import type { DoraBand, DoraMetric, ProjectCostSummary, ProjectHealth } from './types';

const BAND_LABELS: Record<DoraBand, string> = {
  elite: 'Elite',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No data',
};

const BAND_TONES: Record<DoraBand, string> = {
  elite: 'low',
  high: 'info',
  medium: 'medium',
  low: 'high',
  none: 'neutral',
};

function formatHours(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

function formatMetric(metric: DoraMetric, value: number) {
  if (metric.unit === 'per_week') return `${value}/wk`;
  if (metric.unit === 'percent') return `${value}%`;
  return formatHours(value);
}

function Trend({ metric }: { metric: DoraMetric }) {
  if (metric.samples === 0 || metric.previous === 0 || metric.value === metric.previous) {
    return <span className="ig-health__trend">{metric.previous === 0 ? 'No earlier data' : 'Unchanged'}</span>;
  }
  const rising = metric.value > metric.previous;
  const better = metric.lower_is_better ? !rising : rising;
  return (
    <span className={`ig-health__trend ig-health__trend--${better ? 'better' : 'worse'}`}>
      {rising ? '↑' : '↓'} from {formatMetric(metric, metric.previous)}
    </span>
  );
}

function BudgetSection({
  cost,
  renderLink,
}: {
  cost: ProjectCostSummary;
  renderLink?: (href: string, children: ReactNode) => ReactNode;
}) {
  if (cost.tracked_requests === 0 && cost.budget_monthly === 0) return null;
  const committedWidth = cost.budget_monthly > 0 ? Math.min(100, cost.percent_used) : 0;
  const pendingWidth = cost.budget_monthly > 0 ? Math.max(0, Math.min(100, cost.projected_percent) - committedWidth) : 0;
  const link = (href: string, children: ReactNode) =>
    renderLink ? renderLink(href, children) : <a className="ig-health__fix" href={href}>{children}</a>;

  return (
    <div className="ig-health__scorecard">
      <div className="ig-health__score-head">
        <span className="ig-health__label">Monthly spend (Infracost)</span>
        <span className={`ig-health__score ig-health__score--${cost.alert_level === 'over' ? 'poor' : cost.alert_level === 'warn' ? 'fair' : 'good'}`}>
          {formatMoney(cost.projected_monthly, cost.currency)}
          {cost.budget_monthly > 0 ? (
            <span className="ig-health__of"> of {formatMoney(cost.budget_monthly, cost.currency)}</span>
          ) : null}
        </span>
      </div>
      {cost.budget_monthly > 0 ? (
        <div
          className="ig-health__bar ig-health__bar--budget"
          role="progressbar"
          aria-label="Projected share of monthly budget"
          aria-valuenow={Math.round(cost.projected_percent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className={`is-${cost.alert_level}`} style={{ width: `${committedWidth}%` }} />
          <span className="is-pending" style={{ width: `${pendingWidth}%` }} />
        </div>
      ) : null}
      <p className="ig-health__note">
        {formatMoney(cost.committed_monthly, cost.currency)} live
        {cost.pending_monthly !== 0 ? `, ${formatMoney(cost.pending_monthly, cost.currency)} awaiting approval` : ''}.
        {cost.budget_monthly > 0
          ? cost.alert_level === 'over'
            ? ' Over budget once pending requests merge.'
            : cost.alert_level === 'warn'
              ? ` ${Math.round(cost.projected_percent)}% of budget. Owners were notified.`
              : ''
          : ' No budget set.'}
      </p>
      {cost.idle_candidates.length > 0 ? (
        <ul className="ig-health__checks">
          {cost.idle_candidates.map((item) => (
            <li key={item.request_id} className="ig-health__check">
              <span className="ig-health__mark" aria-hidden="true">$</span>
              <div className="ig-health__check-body">
                <strong>
                  Possibly idle: {item.service} in {item.environment}
                </strong>
                <span>
                  {formatMoney(item.monthly_cost, cost.currency)}/mo · no changes in {item.days_idle} days
                </span>
              </div>
              {link(`/tickets?id=${item.request_id}`, 'Review')}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function ProjectHealthCard({
  health,
  loading,
  error,
  renderLink,
}: {
  health: ProjectHealth | null;
  loading?: boolean;
  error?: string;
  /** Portal-specific link renderer (e.g. next/link) for scorecard fixes. */
  renderLink?: (href: string, children: ReactNode) => ReactNode;
}) {
  if (loading) {
    return (
      <section className="ig-health" aria-busy="true" aria-label="Delivery health">
        <div className="ig-health__metrics">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="ig-health__metric">
              <span className="ig-skeleton" style={{ width: '60%', height: 12 }} />
              <span className="ig-skeleton" style={{ width: '40%', height: 24, marginTop: 10 }} />
            </div>
          ))}
        </div>
      </section>
    );
  }
  if (error || !health) {
    return (
      <section className="ig-health" aria-label="Delivery health">
        <p className="ig-health__empty">{error || 'Delivery health is not available for this project yet.'}</p>
      </section>
    );
  }

  const failing = health.scorecard.filter((check) => !check.passed);

  return (
    <section className="ig-health" aria-label="Delivery health">
      <header className="ig-health__head">
        <div>
          <span className="ig-eyebrow">Delivery health · last {health.window_days} days</span>
          <h2 className="ig-health__title">How this project ships</h2>
        </div>
      </header>

      <div className="ig-health__metrics">
        {health.metrics.map((metric) => (
          <article key={metric.key} className="ig-health__metric">
            <div className="ig-health__metric-top">
              <span className="ig-health__label">{metric.label}</span>
              <span className={`ig-chip ig-chip--${BAND_TONES[metric.band]}`}>{BAND_LABELS[metric.band]}</span>
            </div>
            <strong className="ig-health__value">{metric.samples === 0 ? '—' : formatMetric(metric, metric.value)}</strong>
            <Trend metric={metric} />
          </article>
        ))}
      </div>

      <div className="ig-health__scorecard">
        <div className="ig-health__score-head">
          <span className="ig-health__label">Operational scorecard</span>
          <span className={`ig-health__score ig-health__score--${health.score >= 80 ? 'good' : health.score >= 50 ? 'fair' : 'poor'}`}>
            {health.score}%
          </span>
        </div>
        <div
          className="ig-health__bar"
          role="progressbar"
          aria-label="Scorecard checks passed"
          aria-valuenow={health.score}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${health.score}%` }} />
        </div>
        <ul className="ig-health__checks">
          {[...failing, ...health.scorecard.filter((check) => check.passed)].map((check) => (
            <li key={check.key} className={`ig-health__check${check.passed ? ' is-passed' : ''}`}>
              <span className="ig-health__mark" aria-hidden="true">{check.passed ? '✓' : '!'}</span>
              <div className="ig-health__check-body">
                <strong>{check.label}</strong>
                <span>{check.detail}</span>
              </div>
              {!check.passed && check.href ? (
                renderLink ? renderLink(check.href, 'Fix') : <a className="ig-health__fix" href={check.href}>Fix</a>
              ) : null}
              <span className="ig-sr-only">{check.passed ? 'Passed' : 'Needs attention'}</span>
            </li>
          ))}
        </ul>
      </div>

      {health.cost ? <BudgetSection cost={health.cost} renderLink={renderLink} /> : null}
    </section>
  );
}
