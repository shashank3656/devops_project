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
  const total = mandatory.length;
  const next = mandatory.find((step) => !step.done);
  const complete = Boolean(total) && done === total;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <article className="ops-card ops-card--ready ops-ready" aria-label="Complete service setup">
      <h2>Complete service setup</h2>
      <p>
        {complete
          ? <><strong>{serviceName}</strong> has the required setup. Optional integrations stay separate.</>
          : <><strong>{serviceName}</strong> can resume from {next ? next.label.toLowerCase() : 'the next required step'}.</>}
        {' '}Service setup is not release approval.
      </p>
      <div className="ops-ready__meter" role="status">
        <div className="ops-ready__meter-copy">
          <strong>{`${done} / ${total}`}</strong>
          <span>Required setup checks completed</span>
        </div>
        <div className="ops-ready__track" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
      <ol className="ops-ready__steps">
        {mandatory.map((step) => (
          <li key={step.key} className={step.done ? 'is-done' : undefined}>
            <span className="ops-ready__mark" aria-hidden="true">{step.done ? '●' : '○'}</span>
            <span>
              <strong>{step.label}</strong>
              <small>{step.done ? 'Done' : step.detail}</small>
            </span>
            {step.done ? null : (
              <Link href={step.href} className="ops-ready__action">{step.actionLabel}</Link>
            )}
          </li>
        ))}
      </ol>
      {optional.length ? (
        <details className="onboard-advanced ops-ready__optional">
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
        <Link href={resumeHref} className="btn btn-primary btn-sm ops-ready__resume">Resume setup</Link>
      ) : null}
    </article>
  );
}
