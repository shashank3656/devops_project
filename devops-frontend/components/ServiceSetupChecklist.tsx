import Link from 'next/link';
import type { ServiceSetupOptional, ServiceSetupStep } from '../lib/serviceSetup';

export default function ServiceSetupChecklist({
  serviceName,
  steps,
  optional = [],
  resumeHref,
}: {
  serviceName: string;
  steps: ServiceSetupStep[];
  optional?: ServiceSetupOptional[];
  resumeHref?: string;
}) {
  const mandatory = steps.filter((step) => step.mandatory);
  const done = mandatory.filter((step) => step.done).length;
  const next = mandatory.find((step) => !step.done);
  const complete = Boolean(mandatory.length) && done === mandatory.length;
  return (
    <article className="ops-card ops-card--ready ops-ready" aria-label="Complete service setup">
      <h2>Complete service setup</h2>
      <p>
        {complete
          ? <><strong>{serviceName}</strong> has the required setup. Optional integrations stay separate.</>
          : <><strong>{serviceName}</strong> can resume from {next ? next.label.toLowerCase() : 'the next required step'}.</>}
        {' '}Service setup is not release approval.
      </p>
      <div className="ops-ready__meter">
        <strong>{`${done} / ${mandatory.length || 0}`}</strong>
        <span>Required setup checks completed</span>
      </div>
      <ol className="ops-ready__steps">
        {mandatory.map((step) => (
          <li key={step.key}>
            <span aria-hidden>{step.done ? '●' : '○'}</span>
            <span>
              <strong>{step.label}</strong>
              <small>{step.done ? 'Done' : step.detail}</small>
            </span>
            {step.done ? null : (
              <Link href={step.href} className="btn btn-secondary btn-sm">{step.actionLabel}</Link>
            )}
          </li>
        ))}
      </ol>
      {optional.length ? (
        <details className="onboard-advanced">
          <summary>Optional integrations</summary>
          <ul>
            {optional.map((item) => (
              <li key={item.key}>
                <Link href={item.href}>{item.done ? item.label : `Add ${item.label.toLowerCase()}`}</Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {resumeHref && next ? (
        <Link href={resumeHref} className="btn btn-primary btn-sm">Resume setup</Link>
      ) : null}
    </article>
  );
}
