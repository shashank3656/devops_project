import type { RequestCostCheck } from './types';

export function formatMoney(value: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

const VARIANCE_COPY: Record<RequestCostCheck['variance'], string> = {
  within: 'Within the SetuOps estimate',
  above: 'Higher than the SetuOps estimate',
  below: 'Lower than the SetuOps estimate',
  unknown: '',
};

export default function CostCheckCard({ check }: { check: RequestCostCheck | null | undefined }) {
  if (!check) return null;
  const range =
    check.estimate_low === check.estimate_high
      ? formatMoney(check.estimate, 'USD')
      : `${formatMoney(check.estimate_low, 'USD')}–${formatMoney(check.estimate_high, 'USD')}`;

  return (
    <section className="ig-plan" aria-label="Monthly cost">
      <header className="ig-plan__head">
        <span className="ig-eyebrow">Monthly cost</span>
        {check.has_infracost && check.variance === 'above' ? (
          <span className="ig-chip ig-chip--medium">Above estimate</span>
        ) : check.has_infracost ? (
          <span className="ig-chip ig-chip--low">Infracost</span>
        ) : null}
      </header>
      {check.has_infracost ? (
        <dl className="ig-cost">
          <div>
            <dt>Change</dt>
            <dd className={check.diff_monthly_cost > 0 ? 'is-up' : check.diff_monthly_cost < 0 ? 'is-down' : ''}>
              {check.diff_monthly_cost > 0 ? '+' : ''}
              {formatMoney(check.diff_monthly_cost, check.currency)}
            </dd>
          </div>
          <div>
            <dt>Stack total</dt>
            <dd>{formatMoney(check.monthly_cost, check.currency)}</dd>
          </div>
          <div>
            <dt>SetuOps estimate</dt>
            <dd>{range}</dd>
          </div>
        </dl>
      ) : (
        <p className="ig-plan__empty">
          SetuOps estimate {range} per month ({check.estimate_basis}). Infracost figures appear here once CI posts them.
        </p>
      )}
      {check.has_infracost && VARIANCE_COPY[check.variance] ? <p className="ig-cost__note">{VARIANCE_COPY[check.variance]}.</p> : null}
    </section>
  );
}
