import Link from 'next/link';
import type { DeliveryVisibility } from './types';

const STATUS_CLASS: Record<string, string> = {
  success: 'ig-badge ig-badge--success',
  failed: 'ig-badge ig-badge--danger',
  running: 'ig-badge ig-badge--info',
  pending: 'ig-badge ig-badge--muted',
  unknown: 'ig-badge',
};

export default function DeliveryVisibilityCard({
  delivery,
  portal = 'devops',
}: {
  delivery: DeliveryVisibility | null | undefined;
  /** DevOps links use in-app deploy-intelligence; user portal may omit. */
  portal?: 'devops' | 'user' | 'admin';
}) {
  if (!delivery) return null;

  const badgeClass = STATUS_CLASS[delivery.pipeline_status] || STATUS_CLASS.unknown;
  const deployHref =
    portal === 'devops' && delivery.deploy_intel_href ? delivery.deploy_intel_href : undefined;

  return (
    <section className="ig-plan ig-delivery" aria-label="Delivery status">
      <header className="ig-plan__head">
        <span className="ig-eyebrow">Delivery</span>
        <span className={badgeClass}>{delivery.pipeline_label}</span>
      </header>
      <dl className="ig-delivery__grid">
        {delivery.environment ? (
          <>
            <dt>Environment</dt>
            <dd>{['unspecified', 'unknown', '—', '-'].includes(delivery.environment.trim().toLowerCase()) ? 'Scope incomplete' : delivery.environment}</dd>
          </>
        ) : (
          <>
            <dt>Environment</dt>
            <dd>Scope incomplete</dd>
          </>
        )}
        {delivery.last_sha ? (
          <>
            <dt>Last SHA</dt>
            <dd className="ig-mono">{delivery.last_sha.length > 12 ? `${delivery.last_sha.slice(0, 12)}…` : delivery.last_sha}</dd>
          </>
        ) : null}
        {delivery.ci_result ? (
          <>
            <dt>Latest CI</dt>
            <dd>{delivery.ci_result}</dd>
          </>
        ) : null}
        {delivery.promote_state ? (
          <>
            <dt>Promote</dt>
            <dd>{delivery.promote_state}</dd>
          </>
        ) : null}
      </dl>
      <div className="ig-delivery__links">
        {delivery.pipeline_url ? (
          <a href={delivery.pipeline_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
            Open pipeline
          </a>
        ) : null}
        {delivery.pr_url ? (
          <a href={delivery.pr_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
            Open pull request
          </a>
        ) : null}
        {deployHref ? (
          <Link href={deployHref} className="btn btn-secondary btn-sm">
            Deploy intelligence
          </Link>
        ) : null}
      </div>
    </section>
  );
}
