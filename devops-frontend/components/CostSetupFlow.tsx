import Link from 'next/link';

const STEPS = [
  { title: 'Select account', copy: 'Choose a cloud account already assigned to a project you can see.' },
  { title: 'Connect billing source', copy: 'Enable Cost on that account. Demo inventory accounts stay out.' },
  { title: 'Validate access', copy: 'Test the stored billed window. Incomplete stays Unknown, never $0.' },
  { title: 'First collection', copy: 'Import a labelled CUR 2.0 export. Collection is manual in this pilot.' },
  { title: 'View costs', copy: 'The operating bill appears after a complete revision exists.' },
];

export default function CostSetupFlow({
  canOperate,
  state = 'none',
  sampleHref,
  primaryHref = '/cost/configuration',
}: {
  canOperate?: boolean;
  state?: 'none' | 'running' | 'partial' | 'failed' | 'filtered' | 'zero';
  sampleHref?: string;
  primaryHref?: string;
}) {
  const copy = {
    none: 'No billing source is connected yet.',
    running: 'First collection is waiting on an operator import.',
    partial: 'Some billed lines are available. Incomplete amounts stay Unknown.',
    failed: 'Collection did not finish. Spend stays Unknown until a complete revision exists.',
    filtered: 'No results match the selected filters.',
    zero: 'This complete window billed zero. That is a genuine result, not missing data.',
  }[state];
  return (
    <section className="cost-setup" aria-label="Cost setup">
      <h2>Set up Cost</h2>
      <p>{copy}</p>
      <ol className="cost-setup__steps">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="cost-setup__index">{index + 1}</span>
            <strong>{step.title}</strong>
            <span>{step.copy}</span>
          </li>
        ))}
      </ol>
      <div className="cost-setup__actions">
        {canOperate !== false ? <Link href={primaryHref} className="btn btn-primary">Continue setup</Link> : (
          <p>Ask someone with Cost operate to connect an account and ingest billed data.</p>
        )}
        {sampleHref ? <Link href={sampleHref} className="btn btn-secondary">View sample dashboard</Link> : null}
      </div>
    </section>
  );
}
