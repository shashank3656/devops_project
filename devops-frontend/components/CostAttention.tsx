import Link from 'next/link';

export type CostAttentionItem = {
  title: string;
  detail: string;
  href?: string;
  tone?: 'risk' | 'alert' | 'source' | 'neutral';
};

export default function CostAttention({ items }: { items: CostAttentionItem[] }) {
  return (
    <aside className="cost-attention" aria-label="Needs attention">
      <h2>Needs attention</h2>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.title} className={`cost-attention__item cost-attention__item--${item.tone || 'neutral'}`}>
              {item.href ? <Link href={item.href}>{item.title}</Link> : <strong>{item.title}</strong>}
              <span>{item.detail}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No budget risks, unusual increases, or failed sources in this window.</p>
      )}
    </aside>
  );
}
