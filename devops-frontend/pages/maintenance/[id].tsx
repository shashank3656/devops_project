import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';

type WindowDetail = {
  id: number;
  number: string;
  project_name: string;
  environment: string;
  service: string;
  team_name: string;
  owner_name: string;
  change_number: string;
  incident_number: string;
  impact: string;
  description: string;
  starts_at: string;
  ends_at: string;
  status: string;
  created_by_name: string;
  can_decide: boolean;
};

const STEPS = [
  { status: 'pending_manager', label: 'Manager' },
  { status: 'pending_devops', label: 'DevOps manager' },
  { status: 'pending_admin', label: 'Admin' },
];

function statusLabel(status: string): string {
  if (status === 'pending_manager') return 'Waiting for manager';
  if (status === 'pending_devops') return 'Waiting for DevOps manager';
  if (status === 'pending_admin') return 'Waiting for admin';
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  return 'Unknown';
}

function when(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function stepLabel(status: string, step: string): string {
  if (status === 'rejected') return 'Stopped';
  const order = ['pending_manager', 'pending_devops', 'pending_admin', 'approved'];
  const current = order.indexOf(status);
  const mine = order.indexOf(step);
  if (current < 0 || mine < 0) return 'Unknown';
  if (current > mine) return 'Approved';
  if (current === mine) return 'Waiting';
  return 'Not yet';
}

export default function MaintenanceDetailPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const raw = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const id = Number(raw);
  const [item, setItem] = useState<WindowDetail | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) return;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/maintenance/windows/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(typeof data.error === 'string' ? data.error : 'That maintenance record was not found.');
          return;
        }
        setItem(data.window || null);
      })
      .catch(() => setError('That maintenance record was not found.'));
  }, [apiUrl, id]);

  async function decide(decision: 'approve' | 'reject') {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || !item) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/maintenance/windows/${item.id}/decision`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'The decision could not be saved.');
        return;
      }
      setItem(data.window || item);
    } catch {
      setError('The decision could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DevOpsLayout>
      <Head><title>{item?.number || 'Maintenance'}</title></Head>
      <div className="portal-page work-page">
        <header className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">{item?.number || 'Maintenance'}</span>
            <h1 className="portal-page__title">{item?.service || 'Maintenance'}</h1>
            <p className="portal-page__subtitle">{item ? statusLabel(item.status) : 'Loading'}</p>
          </div>
          <Link href="/maintenance" className="btn btn-secondary">Back to maintenance</Link>
        </header>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {item ? (
          <>
            <dl className="request-facts">
              <div><dt>Project</dt><dd>{item.project_name || 'Unknown'}</dd></div>
              <div><dt>Environment</dt><dd>{item.environment || 'Unknown'}</dd></div>
              <div><dt>Service</dt><dd>{item.service}</dd></div>
              <div><dt>Team</dt><dd>{item.team_name || 'Unknown'}</dd></div>
              <div><dt>Owner</dt><dd>{item.owner_name}</dd></div>
              <div><dt>Change</dt><dd>{item.change_number}</dd></div>
              <div><dt>Incident</dt><dd>{item.incident_number || 'None'}</dd></div>
              <div><dt>Start</dt><dd>{when(item.starts_at)}</dd></div>
              <div><dt>End</dt><dd>{when(item.ends_at)}</dd></div>
              <div><dt>Impact</dt><dd>{item.impact}</dd></div>
              <div><dt>Created by</dt><dd>{item.created_by_name || 'Unknown'}</dd></div>
              <div><dt>Description</dt><dd>{item.description}</dd></div>
            </dl>
            <section className="portal-surface">
              <h2>Approval</h2>
              <ol className="request-timeline">
                {STEPS.map((step) => (
                  <li key={step.status}>
                    <strong>{step.label}</strong>
                    <span> {stepLabel(item.status, step.status)}</span>
                  </li>
                ))}
              </ol>
              {item.can_decide ? (
                <div className="portal-page__actions">
                  <button className="btn btn-primary" type="button" disabled={saving} onClick={() => void decide('approve')}>Approve</button>
                  <button className="btn btn-secondary" type="button" disabled={saving} onClick={() => void decide('reject')}>Reject</button>
                </div>
              ) : (
                <p>{item.status === 'approved' || item.status === 'rejected' ? 'This maintenance is finished.' : 'This step is waiting for someone else.'}</p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
