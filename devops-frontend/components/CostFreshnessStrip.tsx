import type { CostCoverage, CostFreshnessDetail } from '../lib/cost';

export default function CostFreshnessStrip({
  detail,
  coverage,
}: {
  detail?: CostFreshnessDetail | null;
  coverage?: CostCoverage | string | null;
}) {
  if (!detail) return null;
  const billed = detail.billed_through || '';
  const hasBilled = Boolean(billed && billed !== 'Unknown');
  if (!hasBilled && (!coverage || coverage === 'none' || coverage === 'Unknown')) return null;
  const synced = detail.last_successful_ingestion
    ? new Date(detail.last_successful_ingestion).toLocaleString()
    : '';
  return (
    <p className="cost-status" aria-label="Billing data status">
      Billing data through {hasBilled ? billed : 'Unknown'}
      {synced ? <><span aria-hidden> · </span>Last synced {synced}</> : null}
    </p>
  );
}
