export type DeploymentVerificationCheck = {
  key?: string;
  label?: string;
  state?: string;
  detail?: string;
  before?: string;
  after?: string;
};

export type DeploymentVerification = {
  state?: string;
  label?: string;
  note?: string;
  environment?: string;
  sha?: string;
  evaluated_at?: string;
  reasons?: string[];
  checks?: DeploymentVerificationCheck[];
};

function toneFor(state?: string) {
  const value = (state || '').toLowerCase();
  if (value === 'healthy' || value === 'passed') return 'ok';
  if (value === 'degraded' || value === 'failed') return 'failed';
  if (value === 'inconclusive' || value === 'unavailable' || value === 'pending') return 'pending';
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

export default function DeploymentVerificationCard({ verification }: { verification?: DeploymentVerification | null }) {
  if (!verification) return null;
  const checks = Array.isArray(verification.checks) ? verification.checks : [];
  return (
    <section className="release-readiness" aria-label="Deployment verification">
      <div className="release-readiness__head">
        <strong>Deployment verification</strong>
        <span className={`delivery-status delivery-status--${toneFor(verification.state)}`}>
          {verification.label || formatState(verification.state)}
        </span>
      </div>
      <p className="release-readiness__note">
        {verification.note || 'Deployment verification compares recorded before and after telemetry. Missing samples stay Inconclusive, never Healthy.'}
      </p>
      <p className="release-readiness__evidence">
        Environment {verification.environment || 'Unknown'} · Commit {shortSHA(verification.sha)}
        {verification.evaluated_at ? ` · evaluated ${verification.evaluated_at}` : ''}
      </p>
      {checks.length ? (
        <ul className="release-readiness__list">
          {checks.map((check) => (
            <li key={check.key || check.label}>
              <span className="release-readiness__check">{check.label}</span>
              <span className={`delivery-status delivery-status--${toneFor(check.state)}`}>{formatState(check.state)}</span>
              <span className="release-readiness__detail">
                {check.before || check.after ? `Before ${check.before || 'Unknown'} → after ${check.after || 'Unknown'}. ` : ''}
                {check.detail}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
