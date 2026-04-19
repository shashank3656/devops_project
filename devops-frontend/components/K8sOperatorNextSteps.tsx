import Link from 'next/link';

interface K8sOperatorNextStepItem {
  href: string;
  label: string;
  detail: string;
}

interface K8sOperatorNextStepsProps {
  eyebrow?: string;
  title: string;
  subtitle: string;
  items: K8sOperatorNextStepItem[];
}

export default function K8sOperatorNextSteps({
  eyebrow = 'Operator flow',
  title,
  subtitle,
  items,
}: K8sOperatorNextStepsProps) {
  if (!items.length) return null;

  return (
    <section className="portal-surface">
      <div className="portal-surface__header">
        <div>
          <span className="portal-surface__eyebrow">{eyebrow}</span>
          <h2 className="portal-surface__title">{title}</h2>
          <p className="portal-surface__subtitle">{subtitle}</p>
        </div>
      </div>

      <div className="k8s-operator-grid">
        {items.map((item) => (
          <Link key={`${item.href}-${item.label}`} href={item.href} className="k8s-operator-card">
            <strong className="k8s-operator-card__title">{item.label}</strong>
            <span className="k8s-operator-card__detail">{item.detail}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
