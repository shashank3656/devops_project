import Link from 'next/link';

export default function CostEmpty({
  title,
  copy,
  actionHref = '/cost/configuration',
  actionLabel = 'Connect billing source',
  canOperate = true,
}: {
  title: string;
  copy: string;
  actionHref?: string;
  actionLabel?: string;
  canOperate?: boolean;
}) {
  return (
    <section className="cost-empty" aria-label={title}>
      <h2>{title}</h2>
      <p>{copy}</p>
      {canOperate ? (
        <Link href={actionHref} className="btn btn-primary">{actionLabel}</Link>
      ) : (
        <p className="cost-empty__note">Ask someone with Cost operate to connect a billing source.</p>
      )}
    </section>
  );
}
