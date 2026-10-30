export type CollectionState = 'ok' | 'partial' | 'no_findings' | 'not_connected' | 'stale' | 'failed';

export function collectionStateFromSync(input: {
  connected?: boolean;
  failed?: boolean;
  lastSuccess?: string | null;
  empty?: boolean;
  staleHours?: number;
}): CollectionState {
  if (input.failed) return 'failed';
  if (!input.connected) return 'not_connected';
  const hours = input.staleHours ?? 24;
  const when = input.lastSuccess ? new Date(input.lastSuccess) : null;
  const valid = Boolean(when && !Number.isNaN(when.getTime()));
  if (!valid) return input.empty ? 'no_findings' : 'stale';
  if (Date.now() - (when as Date).getTime() > hours * 3600 * 1000) return 'stale';
  if (input.empty) return 'no_findings';
  return 'ok';
}

export function collectionStateLabel(state: CollectionState): string {
  switch (state) {
    case 'ok':
      return 'Current';
    case 'partial':
      return 'Partially connected';
    case 'no_findings':
      return 'No findings';
    case 'not_connected':
      return 'Not connected';
    case 'stale':
      return 'Stale';
    case 'failed':
      return 'Collection failed';
  }
}

export default function CollectionStatus({
  source,
  lastSuccess,
  state,
  detail,
}: {
  source: string;
  lastSuccess?: string | null;
  state: CollectionState;
  detail?: string;
}) {
  const when = lastSuccess ? new Date(lastSuccess) : null;
  const lastLabel = when && !Number.isNaN(when.getTime()) ? when.toLocaleString() : lastSuccess || 'Unknown';
  return (
    <p className={`collection-status collection-status--${state}`} aria-label="Data collection status">
      <strong>{collectionStateLabel(state)}</strong>
      {source ? <> · Source {source}</> : null}
      <> · Last successful collection {state === 'not_connected' || state === 'failed' ? 'Unknown' : lastLabel}</>
      {detail ? <> · {detail}</> : null}
    </p>
  );
}
