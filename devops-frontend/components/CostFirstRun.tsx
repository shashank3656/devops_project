import Link from 'next/link';

export default function CostFirstRun({
  canOperate,
  title = 'Set up Cost',
  primaryHref = '/cost/configuration',
  primaryLabel = 'Connect account',
}: {
  canOperate?: boolean;
  title?: string;
  primaryHref?: string;
  primaryLabel?: string;
}) {
  const operate = canOperate !== false;
  return (
    <section className="cost-first-run" aria-label="Set up Cost">
      <h2>{title}</h2>
      <ol className="cost-first-run__steps">
        <li>
          <strong>Connect account</strong>
          <span>Assign a cloud account to a project you can see, then enable Cost. Demo inventory accounts stay out.</span>
        </li>
        <li>
          <strong>Validate source</strong>
          <span>Confirm the billed window is complete. Incomplete stays Unknown, never $0.</span>
        </li>
        <li>
          <strong>Ingest billed data</strong>
          <span>Import a labelled CUR export. Spend stays Unknown until a complete revision exists.</span>
        </li>
      </ol>
      {operate ? (
        <Link href={primaryHref} className="btn btn-primary">{primaryLabel}</Link>
      ) : (
        <p className="cost-first-run__note">Ask someone with Cost operate to connect an account and ingest billed data.</p>
      )}
    </section>
  );
}
