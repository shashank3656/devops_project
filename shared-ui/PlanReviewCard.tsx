import { useEffect, useState } from 'react';
import type { PlanChange, PlanReview } from './types';
import { formatRelativeTime } from './time';

const ACTION_LABELS: Record<PlanChange['action'], string> = {
  destroy: 'Destroy',
  replace: 'Replace',
  update: 'Update',
  create: 'Create',
  read: 'Read',
};

export default function PlanReviewCard({
  review,
  env,
  onAcknowledge,
}: {
  review: PlanReview | null | undefined;
  env?: string;
  /** Omit to render read-only. Should throw with a readable message on failure. */
  onAcknowledge?: (planHash: string, note: string) => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setConfirmed(false);
    setNote('');
    setError('');
  }, [review?.plan_hash]);

  if (!review || !review.has_plan) {
    return (
      <section className="ig-plan" aria-label="Terraform plan">
        <header className="ig-plan__head">
          <span className="ig-eyebrow">Terraform plan</span>
        </header>
        <p className="ig-plan__empty">No plan yet. CI posts it here once the pull request's plan job finishes.</p>
      </section>
    );
  }

  const deletes = review.destroy_only + review.replace;
  const blocking = review.requires_ack && !review.acknowledged;

  const submit = async () => {
    if (!onAcknowledge || !review.plan_hash || !confirmed) return;
    setSaving(true);
    setError('');
    try {
      await onAcknowledge(review.plan_hash, note.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the acknowledgement.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`ig-plan${blocking ? ' ig-plan--blocking' : ''}`} aria-label="Terraform plan">
      <header className="ig-plan__head">
        <span className="ig-eyebrow">Terraform plan</span>
        {review.no_changes ? (
          <span className="ig-chip ig-chip--low">No changes</span>
        ) : blocking ? (
          <span className="ig-chip ig-chip--danger">Needs acknowledgement</span>
        ) : review.requires_ack ? (
          <span className="ig-chip ig-chip--low">Acknowledged</span>
        ) : deletes > 0 ? (
          <span className="ig-chip ig-chip--medium">Deletes resources</span>
        ) : null}
      </header>

      {!review.no_changes ? (
        <dl className="ig-plan__counts">
          <div className="ig-plan__count ig-plan__count--create">
            <dt>Create</dt>
            <dd>{review.add - review.replace > 0 ? review.add - review.replace : 0}</dd>
          </div>
          <div className="ig-plan__count ig-plan__count--update">
            <dt>Update</dt>
            <dd>{review.change}</dd>
          </div>
          <div className="ig-plan__count ig-plan__count--replace">
            <dt>Replace</dt>
            <dd>{review.replace}</dd>
          </div>
          <div className="ig-plan__count ig-plan__count--destroy">
            <dt>Destroy</dt>
            <dd>{review.destroy_only}</dd>
          </div>
        </dl>
      ) : null}

      {review.changes.length > 0 ? (
        <ul className="ig-plan__changes">
          {review.changes.map((change) => (
            <li key={`${change.action}:${change.address}`} className={`ig-plan__change ig-plan__change--${change.action}`}>
              <span className="ig-plan__action">{ACTION_LABELS[change.action]}</span>
              <code className="ig-mono">{change.address}</code>
            </li>
          ))}
          {review.truncated ? <li className="ig-plan__more">More changes in the full plan output below.</li> : null}
        </ul>
      ) : null}

      {review.requires_ack && review.acknowledged ? (
        <p className="ig-plan__ack">
          Acknowledged by <strong>{review.acknowledged_by || 'a reviewer'}</strong>
          {review.acknowledged_at ? ` ${formatRelativeTime(review.acknowledged_at)}` : ''}
          {review.ack_note ? <> · “{review.ack_note}”</> : null}
        </p>
      ) : null}

      {blocking ? (
        onAcknowledge ? (
          <div className="ig-plan__gate">
            <p className="ig-plan__warning">
              This plan permanently deletes or recreates {deletes} {deletes === 1 ? 'resource' : 'resources'} in{' '}
              <strong>{env || 'production'}</strong>. Data on them may be lost. Merge stays blocked until someone acknowledges it.
            </p>
            <label className="ig-plan__confirm">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>I reviewed the resources above and accept that they will be deleted or replaced.</span>
            </label>
            <input
              className="input"
              aria-label="Acknowledgement note"
              placeholder="Note for the audit log (optional), e.g. data migrated to new bucket"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
            {error ? (
              <p className="ig-plan__error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="button" className="btn btn-danger btn-sm" disabled={!confirmed || saving} onClick={() => void submit()}>
              {saving ? 'Saving…' : 'Acknowledge and unblock merge'}
            </button>
          </div>
        ) : (
          <p className="ig-plan__warning">A DevOps manager or admin must acknowledge these deletions before the pull request can merge.</p>
        )
      ) : null}
    </section>
  );
}
