import type { CostEstimate } from './types';

const RISK_LABELS = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const;

function money(value: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `$${Math.round(value)}`;
  }
}

export default function EstimatePanel({
  estimate,
  loading = false,
  ready = true,
  title = 'Estimate',
}: {
  estimate: CostEstimate | null;
  loading?: boolean;
  ready?: boolean;
  title?: string;
}) {
  if (!ready) {
    return (
      <section className="ig-estimate" aria-label={title}>
        <span className="ig-eyebrow">{title}</span>
        <p className="ig-estimate__empty">Pick a cloud and service to see the monthly cost, risk and who approves it.</p>
      </section>
    );
  }

  if (loading && !estimate) {
    return (
      <section className="ig-estimate" aria-label={title} aria-busy="true">
        <span className="ig-eyebrow">{title}</span>
        <span className="ig-skeleton ig-skeleton--line" style={{ width: '60%', height: 28 }} />
        <span className="ig-skeleton ig-skeleton--line" />
        <span className="ig-skeleton ig-skeleton--line" style={{ width: '70%' }} />
      </section>
    );
  }

  if (!estimate) {
    return (
      <section className="ig-estimate" aria-label={title}>
        <span className="ig-eyebrow">{title}</span>
        <p className="ig-estimate__empty">No estimate available right now. You can still send the request.</p>
      </section>
    );
  }

  const currency = estimate.currency || 'USD';
  const budget = estimate.budget_monthly || 0;
  const pct = Math.max(0, estimate.budget_used_pct || 0);
  const over = estimate.allowed === false;
  const budgetTone = over ? 'danger' : pct >= 80 ? 'warn' : 'ok';
  const risk = estimate.risk_level || 'low';
  const showRange =
    !estimate.estimate_exact &&
    typeof estimate.estimate_low === 'number' &&
    typeof estimate.estimate_high === 'number' &&
    estimate.estimate_high > estimate.estimate_low;
  const notes = estimate.impact_notes || [];
  const approvers = estimate.approval_path || [];

  return (
    <section className={`ig-estimate${loading ? ' is-refreshing' : ''}`} aria-label={title} aria-live="polite">
      <span className="ig-eyebrow">{title}</span>
      <div className="ig-estimate__price">
        <strong>{showRange ? '~' : ''}{money(estimate.estimated_monthly, currency)}</strong>
        <span>/ month</span>
      </div>
      {showRange ? (
        <p className="ig-estimate__basis">
          Typical range {money(estimate.estimate_low as number, currency)}–{money(estimate.estimate_high as number, currency)}
          {estimate.estimate_basis ? ` · ${estimate.estimate_basis}` : ''}
        </p>
      ) : estimate.estimate_basis ? (
        <p className="ig-estimate__basis">{estimate.estimate_basis}</p>
      ) : null}

      {budget > 0 ? (
        <div className={`ig-estimate__budget ig-estimate__budget--${budgetTone}`}>
          <div className="ig-estimate__budget-head">
            <span>{over ? 'Over project budget' : pct >= 80 ? 'Close to project budget' : 'Within project budget'}</span>
            <span>{pct}%</span>
          </div>
          <div
            className="ig-estimate__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(pct, 100)}
            aria-label="Share of monthly project budget"
          >
            <span style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <p className="ig-estimate__budget-meta">
            {money(estimate.estimated_monthly, currency)} of {money(budget, currency)} monthly budget
          </p>
        </div>
      ) : (
        <p className="ig-estimate__basis">This project has no monthly budget set.</p>
      )}

      {estimate.warning ? (
        <p className={`ig-estimate__warning${over ? ' is-blocking' : ''}`} role={over ? 'alert' : undefined}>
          {estimate.warning}
        </p>
      ) : null}

      <div className="ig-estimate__section">
        <div className="ig-estimate__section-head">
          <span>Production impact</span>
          <span className={`ig-badge ig-badge--${risk}`}>{RISK_LABELS[risk]}</span>
        </div>
        {notes.length > 0 ? (
          <ul className="ig-estimate__notes">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {approvers.length > 0 ? (
        <div className="ig-estimate__section">
          <div className="ig-estimate__section-head">
            <span>Approvers</span>
          </div>
          <ol className="ig-estimate__approvers">
            {approvers.map((approver, index) => (
              <li key={`${approver}-${index}`}>
                <span className="ig-estimate__approver-index" aria-hidden>
                  {index + 1}
                </span>
                {approver}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {estimate.calculator_url ? (
        <a className="ig-estimate__link" href={estimate.calculator_url} target="_blank" rel="noreferrer">
          Open pricing calculator
        </a>
      ) : null}
    </section>
  );
}
