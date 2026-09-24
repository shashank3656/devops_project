import { useState } from 'react';
import { formatRelativeTime, type RequestLifetime } from '@infragate/ui';
import { useToast } from '../context/ToastContext';

interface Props {
  apiUrl: string;
  requestId: number;
  status: string;
  lifetime: RequestLifetime | null;
  canManage: boolean;
  onLifetimeChange: (lifetime: RequestLifetime) => void;
  onRequestCreated: (id: number) => void;
}

const LIFETIME_OPTIONS = [7, 14, 30];
const DELIVERED = ['completed', 'in_progress'];

export default function RequestLifecyclePanel({ apiUrl, requestId, status, lifetime, canManage, onLifetimeChange, onRequestCreated }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(LIFETIME_OPTIONS[0]);
  const [confirmingDecommission, setConfirmingDecommission] = useState(false);
  const [reason, setReason] = useState('');

  const delivered = DELIVERED.includes(status);
  const operation = lifetime?.operation;
  const decommissionId = lifetime?.decommission_request_id;
  if (!canManage && !operation && !lifetime?.expires_at) return null;

  const call = async (path: string, method: string, body: unknown) => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') return null;
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/request/${requestId}/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error || 'Request failed', 'error');
        return null;
      }
      return data;
    } catch (_) {
      toast('Request failed', 'error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveLifetime = async (value: number) => {
    const data = await call('lifetime', 'PUT', { days: value });
    if (data?.lifetime) {
      onLifetimeChange(data.lifetime);
      toast(value === 0 ? 'Expiry removed' : `Expires in ${value} days`, 'success');
    }
  };

  const startDay2 = async (action: 'resize' | 'decommission') => {
    const data = await call('day2', 'POST', { action, reason: action === 'decommission' ? reason.trim() : '' });
    if (data?.id) {
      toast(data.message || 'Request created', 'success');
      setConfirmingDecommission(false);
      setReason('');
      onRequestCreated(data.id);
    }
  };

  const expiresAt = lifetime?.expires_at;
  const expiringSoon = expiresAt != null && (lifetime?.days_left ?? 0) <= 3;

  return (
    <section className="ig-lifecycle" aria-label="Lifecycle">
      <header className="ig-lifecycle__head">
        <span className="ig-eyebrow">Lifecycle</span>
        {expiresAt ? (
          <span className={`ig-chip ig-chip--${expiringSoon ? 'high' : 'medium'}`}>
            Expires {formatRelativeTime(expiresAt)}
          </span>
        ) : null}
      </header>

      {operation ? (
        <p className="ig-lifecycle__note">
          {operation.operation === 'decommission' ? 'Decommissions' : 'Changes'} the infrastructure from request #{operation.source_request_id}.
        </p>
      ) : null}

      {decommissionId ? (
        <p className="ig-lifecycle__note">
          Decommission is in progress as request #{decommissionId}.{' '}
          <button type="button" className="ig-lifecycle__link" onClick={() => onRequestCreated(decommissionId)}>
            Open it
          </button>
        </p>
      ) : null}

      {canManage && delivered && !decommissionId && lifetime?.can_set_lifetime ? (
        <div className="ig-lifecycle__row">
          <label className="ig-lifecycle__label" htmlFor={`lifetime-${requestId}`}>
            {expiresAt ? 'Extend by' : 'Temporary environment'}
          </label>
          <select
            id={`lifetime-${requestId}`}
            className="ig-lifecycle__select"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            disabled={busy}
          >
            {LIFETIME_OPTIONS.map((option) => (
              <option key={option} value={option}>{option} days</option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => saveLifetime(days)}>
            {expiresAt ? 'Extend' : 'Set expiry'}
          </button>
          {expiresAt ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => saveLifetime(0)}>
              Keep permanently
            </button>
          ) : null}
        </div>
      ) : null}
      {canManage && delivered && !decommissionId && lifetime?.can_set_lifetime ? (
        <p className="ig-lifecycle__hint">
          On expiry SetuOps opens a decommission request for approval. You get a reminder 3 days before.
        </p>
      ) : null}

      {canManage && delivered && !decommissionId && !operation ? (
        <div className="ig-lifecycle__row">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => startDay2('resize')}>
            Change size
          </button>
          {!confirmingDecommission ? (
            <button type="button" className="btn btn-ghost btn-sm ig-lifecycle__danger" disabled={busy} onClick={() => setConfirmingDecommission(true)}>
              Decommission…
            </button>
          ) : null}
        </div>
      ) : null}

      {confirmingDecommission ? (
        <form
          className="ig-lifecycle__confirm"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) startDay2('decommission');
          }}
        >
          <label className="ig-lifecycle__label" htmlFor={`decommission-reason-${requestId}`}>
            Why is this no longer needed?
          </label>
          <textarea
            id={`decommission-reason-${requestId}`}
            className="ig-lifecycle__textarea"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setConfirmingDecommission(false);
              }
            }}
            autoFocus
          />
          <p className="ig-lifecycle__hint">
            This goes through the normal approvals. Resources are destroyed only after the pull request is approved and merged.
          </p>
          <div className="ig-lifecycle__row">
            <button type="submit" className="btn btn-danger btn-sm" disabled={busy || !reason.trim()}>
              Request decommission
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmingDecommission(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
