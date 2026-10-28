export type ReleaseReadinessCheck = {
  key?: string;
  label?: string;
  state?: string;
  detail?: string;
  owner?: string;
};

export type ReleaseReadiness = {
  state?: string;
  label?: string;
  note?: string;
  sha?: string;
  source?: string;
  evaluated_at?: string;
  owner?: string;
  reasons?: string[];
  checks?: ReleaseReadinessCheck[];
};

function toneFor(state?: string) {
  const value = (state || '').toLowerCase();
  if (value === 'passed' || value === 'approved' || value === 'allowed' || value === 'documented' || value === 'ready') return 'ok';
  if (value === 'failed' || value === 'blocked' || value === 'conflict' || value === 'freeze') return 'failed';
  if (value === 'pending' || value === 'awaiting' || value === 'awaiting_evidence') return 'pending';
  if (value === 'skipped') return 'skipped';
  return 'unknown';
}

function formatState(state?: string) {
  const value = (state || 'unavailable').replace(/_/g, ' ');
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function shortSHA(sha?: string) {
  const value = (sha || '').trim();
  if (!value) return 'Unknown';
  return value.length > 12 ? value.slice(0, 12) : value;
}

export default function ReleaseReadinessCard({ readiness }: { readiness?: ReleaseReadiness | null }) {
  if (!readiness) return null;
  const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
  return (
    <section className="release-readiness" aria-label="Release readiness">
      <div className="release-readiness__head">
        <strong>Release readiness</strong>
        <span className={`delivery-status delivery-status--${toneFor(readiness.state)}`}>
          {readiness.label || formatState(readiness.state)}
        </span>
      </div>
      <p className="release-readiness__note">
        {readiness.note || 'Release readiness is not deployment authorization. The risk score is a separate impact estimate.'}
      </p>
      {readiness.owner ? <p className="release-readiness__evidence">Owner {readiness.owner}</p> : null}
      <p className="release-readiness__evidence">
        Commit {shortSHA(readiness.sha)} · {readiness.source || 'Unknown source'}
        {readiness.evaluated_at ? ` · evaluated ${readiness.evaluated_at}` : ''}
      </p>
      {readiness.reasons?.length ? (
        <ul className="release-readiness__list">
          {readiness.reasons.map((reason) => (
            <li key={reason}>
              <span className="release-readiness__detail">{reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {checks.length ? (
        <ul className="release-readiness__list">
          {checks.map((check) => (
            <li key={check.key || check.label}>
              <span className="release-readiness__check">{check.label}</span>
              <span className={`delivery-status delivery-status--${toneFor(check.state)}`}>{formatState(check.state)}</span>
              <span className="release-readiness__detail">
                {check.detail}
                {check.owner ? ` · ${check.owner}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
