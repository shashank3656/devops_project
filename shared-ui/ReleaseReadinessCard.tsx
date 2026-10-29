export type ReleaseReadinessCheck = {
  key?: string;
  label?: string;
  state?: string;
  detail?: string;
  owner?: string;
  action_key?: string;
  action_label?: string;
  action_href?: string;
};

export type ReleaseReadiness = {
  state?: string;
  label?: string;
  note?: string;
  sha?: string;
  source?: string;
  evaluated_at?: string;
  author?: string;
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

function blockingChecks(checks: ReleaseReadinessCheck[]) {
  return checks.filter((check) => {
    const tone = toneFor(check.state);
    return tone === 'failed' || tone === 'pending' || tone === 'unknown';
  });
}

function CheckAction({
  check,
  onAction,
}: {
  check: ReleaseReadinessCheck;
  onAction?: (check: ReleaseReadinessCheck) => void;
}) {
  const label = (check.action_label || '').trim();
  if (!label) return null;
  const href = (check.action_href || '').trim();
  if (href) {
    const external = /^https?:\/\//i.test(href);
    return (
      <a
        className="btn btn-secondary btn-sm release-readiness__action"
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer' : undefined}
      >
        {label}
      </a>
    );
  }
  if (!onAction) return null;
  return (
    <button type="button" className="btn btn-secondary btn-sm release-readiness__action" onClick={() => onAction(check)}>
      {label}
    </button>
  );
}

function CheckRow({
  check,
  onAction,
}: {
  check: ReleaseReadinessCheck;
  onAction?: (check: ReleaseReadinessCheck) => void;
}) {
  return (
    <li>
      <span className="release-readiness__check">{check.label}</span>
      <span className={`delivery-status delivery-status--${toneFor(check.state)}`}>{formatState(check.state)}</span>
      <span className="release-readiness__detail">
        {check.detail}
        {check.owner ? ` · ${check.owner}` : ''}
      </span>
      <CheckAction check={check} onAction={onAction} />
    </li>
  );
}

export default function ReleaseReadinessCard({
  readiness,
  compact = false,
  onAction,
}: {
  readiness?: ReleaseReadiness | null;
  compact?: boolean;
  onAction?: (check: ReleaseReadinessCheck) => void;
}) {
  if (!readiness) return null;
  const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
  const blockers = blockingChecks(checks);
  const reasons = Array.isArray(readiness.reasons) ? readiness.reasons : [];
  return (
    <section className="release-readiness" aria-label="Release readiness">
      <div className="release-readiness__head">
        <strong>Release readiness</strong>
        <span className={`delivery-status delivery-status--${toneFor(readiness.state)}`}>
          {readiness.label || formatState(readiness.state)}
        </span>
      </div>
      {readiness.author ? <p className="release-readiness__evidence">Author {readiness.author}</p> : null}
      {readiness.owner ? <p className="release-readiness__evidence">Assigned reviewer {readiness.owner}</p> : <p className="release-readiness__evidence">No assigned reviewer</p>}
      {compact ? (
        blockers.length ? (
          <ul className="release-readiness__list">
            {blockers.map((check) => <CheckRow key={check.key || check.label} check={check} onAction={onAction} />)}
          </ul>
        ) : reasons.length ? (
          <ul className="release-readiness__list">
            {reasons.map((reason) => (
              <li key={reason}>
                <span className="release-readiness__detail">{reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="release-readiness__evidence">No readiness blockers recorded.</p>
        )
      ) : (
        <>
          <p className="release-readiness__note">
            {readiness.note || 'Release readiness is not deployment authorization. The risk score is a separate impact estimate.'}
          </p>
          <p className="release-readiness__evidence">
            Commit {shortSHA(readiness.sha)} · {readiness.source || 'Unknown source'}
            {readiness.evaluated_at ? ` · evaluated ${readiness.evaluated_at}` : ''}
          </p>
          {checks.length ? (
            <ul className="release-readiness__list">
              {checks.map((check) => <CheckRow key={check.key || check.label} check={check} onAction={onAction} />)}
            </ul>
          ) : reasons.length ? (
            <ul className="release-readiness__list">
              {reasons.map((reason) => (
                <li key={reason}>
                  <span className="release-readiness__detail">{reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
