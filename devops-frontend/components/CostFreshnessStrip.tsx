import CollectionStatus, { type CollectionState } from './CollectionStatus';
import type { CostCoverage, CostFreshnessDetail } from '../lib/cost';

function costCollectionState(coverage?: CostCoverage | string | null, detail?: CostFreshnessDetail | null): CollectionState {
  const billed = detail?.billed_through || '';
  const hasBilled = Boolean(billed && billed !== 'Unknown');
  if (!hasBilled && (!coverage || coverage === 'none' || coverage === 'Unknown')) return 'not_connected';
  if (coverage === 'incomplete') return 'stale';
  if (!hasBilled) return 'failed';
  return 'ok';
}

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
  if (!hasBilled && (!coverage || coverage === 'none' || coverage === 'Unknown')) {
    return (
      <CollectionStatus
        source="CUR 2.0"
        lastSuccess={detail.last_successful_ingestion}
        state="not_connected"
        detail={detail.note || 'Billing is not connected for this window.'}
      />
    );
  }
  return (
    <CollectionStatus
      source="CUR 2.0"
      lastSuccess={detail.last_successful_ingestion}
      state={costCollectionState(coverage, detail)}
      detail={hasBilled ? `Billed through ${billed}` : detail.note}
    />
  );
}
