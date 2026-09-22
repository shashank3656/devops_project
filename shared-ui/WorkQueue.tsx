import Link from 'next/link';
import EmptyState from './EmptyState';
import StatusChip from './StatusChip';
import type { QueueItem } from './types';

export default function WorkQueue({ title, items }: { title: string; items: QueueItem[] }) {
  return (
    <section className="ig-queue">
      <span className="ig-eyebrow">Needs you</span>
      <h2>{title}</h2>
      {items.length === 0 ? (
        <EmptyState title="Nothing waiting" body="New approvals, incidents, and risky merges will show up here." />
      ) : (
        <ul className="ig-queue__list">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="ig-queue__item">
                <div>
                  <div className="ig-queue__title">{item.title}</div>
                  <div className="ig-queue__meta">{item.meta}</div>
                </div>
                <StatusChip tone={item.tone} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
