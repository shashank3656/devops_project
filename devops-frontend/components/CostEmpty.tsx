import Link from 'next/link';

export default function CostEmpty({
  title,
  copy,
  actionHref = '/cost/configuration',
  actionLabel = 'Connect billing source',
  canOperate = true,
  deniedNote = 'Ask someone with Cost operate to connect a billing source.',
}: {
  title: string;
  copy: string;
  actionHref?: string;
  actionLabel?: string;
  canOperate?: boolean;
  deniedNote?: string;
}) {
  return (
    <section className="cost-empty" aria-label={title}>
      <h2>{title}</h2>
      <p>{copy}</p>
      {canOperate ? (
        <Link href={actionHref} className="btn btn-primary">{actionLabel}</Link>
      ) : (
        <p className="cost-empty__note">{deniedNote}</p>
      )}
    </section>
  );
}
