import Link from 'next/link';
import RelativeTime from './RelativeTime';
import type { QueueItem, Tone } from './types';

const KIND_LABELS: Record<string, string> = {
  approval: 'Approval',
  incident: 'Incident',
  pr_risk: 'PR risk',
  freeze: 'Freeze',
  coverage: 'Coverage',
  rejected: 'Rejected',
  draft: 'Draft',
  waiting: 'In review',
  change: 'Change',
  failed: 'Failed',
  blocked: 'Blocked',
};

const KIND_TONES: Record<string, Tone> = {
  approval: 'medium',
  incident: 'high',
  freeze: 'danger',
  coverage: 'medium',
  rejected: 'danger',
  draft: 'medium',
  waiting: 'info',
  change: 'medium',
  failed: 'danger',
  blocked: 'danger',
};

function badgeTone(item: QueueItem): Tone {
  if (item.kind === 'pr_risk') return item.tone || 'medium';
  return (item.kind && KIND_TONES[item.kind]) || item.tone || 'info';
}

export default function WorkQueue({
  items,
  loading = false,
  emptyTitle = "You're all caught up",
  emptyBody = 'New approvals, incidents, and risky merges will show up here.',
  emptyPresentation = 'success',
}: {
  items: QueueItem[];
  loading?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  emptyPresentation?: 'success' | 'scope' | 'empty';
}) {
  if (loading) {
    return (
      <div className="ig-home-panel ig-home-queue" aria-busy="true">
        {[0, 1, 2].map((key) => (
          <div key={key} className="ig-home-queue__row ig-home-queue__row--skeleton">
            <span className="ig-skeleton ig-skeleton--badge" />
            <span className="ig-skeleton ig-skeleton--line" />
            <span className="ig-skeleton ig-skeleton--button" />
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={`ig-home-panel ig-home-empty${emptyPresentation === 'success' ? '' : ' ig-home-empty--plain'}`}>
        {emptyPresentation === 'success' ? (
          <span className="ig-home-empty__icon" aria-hidden>
            <svg viewBox="0 0 24 24">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
        ) : null}
        <div>
          <strong>{emptyTitle}</strong>
          <p>{emptyBody}</p>
        </div>
      </div>
    );
  }

  return (
    <ul className="ig-home-panel ig-home-queue">
      {items.map((item) => {
        const tone = badgeTone(item);
        return (
          <li key={item.id}>
            <Link href={item.href} className="ig-home-queue__row">
              <span className={`ig-badge ig-badge--${tone}`}>{(item.kind && KIND_LABELS[item.kind]) || 'Update'}</span>
              <span className="ig-home-queue__body">
                <span className="ig-home-queue__title">{item.title}</span>
                <span className="ig-home-queue__meta">{item.meta}</span>
              </span>
              <span className="ig-home-queue__ref">
                {item.ref ? <code>{item.ref}</code> : null}
                {item.at ? <span><RelativeTime value={item.at} /></span> : null}
              </span>
              <span className="ig-home-queue__action">{item.action || 'Open'}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
