import type { CostFreshnessDetail } from '../lib/cost';

export default function CostFreshnessStrip({ detail }: { detail?: CostFreshnessDetail | null }) {
  if (!detail) return null;
  return (
    <dl className="cost-k8s-meta" aria-label="Billing freshness">
      <div>
        <dt>Billed through</dt>
        <dd>{detail.billed_through || 'Unknown'}</dd>
      </div>
      <div>
        <dt>Last successful ingestion</dt>
        <dd>{detail.last_successful_ingestion ? new Date(detail.last_successful_ingestion).toLocaleString() : 'Unknown'}</dd>
      </div>
      <div>
        <dt>Last dashboard refresh</dt>
        <dd>{detail.last_dashboard_refresh ? new Date(detail.last_dashboard_refresh).toLocaleString() : 'Unknown'}</dd>
      </div>
      <div>
        <dt>Provider pull</dt>
        <dd>Refreshing this page does not pull newer billing</dd>
      </div>
    </dl>
  );
}
