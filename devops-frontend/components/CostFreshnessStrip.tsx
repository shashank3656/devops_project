import type { CostCoverage, CostFreshnessDetail } from '../lib/cost';

export default function CostFreshnessStrip({
  detail,
  coverage,
}: {
  detail?: CostFreshnessDetail | null;
  coverage?: CostCoverage | string | null;
}) {
  if (!detail) return null;
  const billed = detail.billed_through || 'Unknown';
  const synced = detail.last_successful_ingestion
    ? new Date(detail.last_successful_ingestion).toLocaleString()
    : 'Unknown';
  return (
    <div className="cost-status" aria-label="Billing data status">
      <p>
        Billing data through {billed}
        <span aria-hidden> · </span>
        Last synced {synced}
        <span aria-hidden> · </span>
        Coverage {coverage || 'Unknown'}
      </p>
      <p className="cost-status__note">Refreshing this page does not pull newer provider billing.</p>
    </div>
  );
}
