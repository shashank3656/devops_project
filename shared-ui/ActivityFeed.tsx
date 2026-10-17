import Link from 'next/link';
import RelativeTime from './RelativeTime';
import { initialsFor } from './time';
import type { ActivityItem } from './types';

export default function ActivityFeed({
  items,
  loading = false,
  viewAllHref,
  title = 'Recent operations',
}: {
  items: ActivityItem[];
  loading?: boolean;
  viewAllHref?: string;
  title?: string;
}) {
  return (
    <section className="ig-home-panel ig-home-activity" aria-labelledby="ig-home-activity-title">
      <header className="ig-home-activity__header">
        <h2 id="ig-home-activity-title">{title}</h2>
        {viewAllHref ? (
          <Link href={viewAllHref} className="ig-home-link">
            View all
          </Link>
        ) : null}
      </header>
      {loading ? (
        <ul className="ig-home-activity__list" aria-busy="true">
          {[0, 1, 2, 3].map((key) => (
            <li key={key} className="ig-home-activity__item">
              <span className="ig-skeleton ig-skeleton--avatar" />
              <span className="ig-home-activity__body">
                <span className="ig-skeleton ig-skeleton--line" />
                <span className="ig-skeleton ig-skeleton--line" style={{ width: '60%' }} />
              </span>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="ig-home-activity__empty">Nothing has happened yet. Changes to requests and incidents appear here.</p>
      ) : (
        <ul className="ig-home-activity__list">
          {items.map((item) => {
            const content = (
              <>
                <span className={`ig-home-avatar ig-home-avatar--${item.tone || 'info'}`} aria-hidden>
                  {initialsFor(item.actor || item.summary)}
                </span>
                <span className="ig-home-activity__body">
                  <span className="ig-home-activity__summary">{item.summary}</span>
                  {item.detail ? <span className="ig-home-activity__detail">{item.detail}</span> : null}
                </span>
                <time className="ig-home-activity__time" dateTime={item.at}>
                  <RelativeTime value={item.at} />
                </time>
              </>
            );
            return (
              <li key={item.id}>
                {item.href ? (
                  <Link href={item.href} className="ig-home-activity__item">
                    {content}
                  </Link>
                ) : (
                  <div className="ig-home-activity__item">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
