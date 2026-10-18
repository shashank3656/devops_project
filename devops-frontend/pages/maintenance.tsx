import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { formatOperationalTime } from '@infragate/ui';
import DevOpsLayout from '../components/DevOpsLayout';
import { sessionRole } from '../components/deskClient';
import { useApiUrl } from '../context/ApiUrlContext';

const TOKEN_KEY = 'devops_token';

type WindowRow = {
  id: number;
  number: string;
  project_name: string;
  service: string;
  environment: string;
  starts_at: string;
  ends_at: string;
  status: string;
  can_decide: boolean;
};

const STATUS_OPTIONS = [
  { value: 'pending_manager', label: 'Waiting for manager' },
  { value: 'pending_devops', label: 'Waiting for DevOps manager' },
  { value: 'pending_admin', label: 'Waiting for admin' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function statusLabel(status: string): string {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label || 'Unknown';
}

function when(value: string): string {
  return formatOperationalTime(value, 'Unknown');
}

export default function MaintenancePage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const canWrite = sessionRole() !== 'viewer';
  const [items, setItems] = useState<WindowRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    fetch(`${apiUrl}/api/maintenance/windows`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(typeof data.error === 'string' ? data.error : 'Maintenance could not be loaded.');
          return;
        }
        setItems(Array.isArray(data.windows) ? data.windows : []);
      })
      .catch(() => setError('Maintenance could not be loaded.'))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  const filtering = Boolean(query.trim() || status);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (status && item.status !== status) return false;
      if (!needle) return true;
      return [item.number, item.project_name, item.service, item.environment].join(' ').toLowerCase().includes(needle);
    });
  }, [items, query, status]);

  return (
    <DevOpsLayout>
      <Head><title>Maintenance</title></Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Maintenance</span>
            <h1 className="portal-page__title">Maintenance</h1>
            <p className="portal-page__subtitle">A planned window is approved by the creator’s manager, then a DevOps manager, then an admin.</p>
          </div>
          {canWrite ? <Link href="/maintenance/new" className="btn btn-primary">Create</Link> : null}
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-surface">
          <form className="iam-filters" onSubmit={(event) => event.preventDefault()}>
            <label>
              Search
              <input className="input" type="search" value={query} placeholder="Number, project, or service" onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label>
              Status
              <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <div className="iam-filters__actions">
              {filtering ? <button type="button" className="btn btn-secondary" onClick={() => { setQuery(''); setStatus(''); }}>Clear</button> : null}
            </div>
          </form>
          {loading ? <div className="empty-state">Loading maintenance...</div> : null}
          {!loading && !visible.length ? (
            <div className="empty-state">{filtering ? 'No maintenance matches this filter.' : 'No maintenance windows yet.'}</div>
          ) : null}
          {visible.length ? (
            <table className="templates-table">
              <thead>
                <tr>
                  <th>Maintenance</th>
                  <th>Service</th>
                  <th>Window</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => void router.push(`/maintenance/${item.id}`)}>
                    <td>
                      <strong><Link href={`/maintenance/${item.id}`} onClick={(event) => event.stopPropagation()}>{item.number}</Link></strong>
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.project_name || 'Unknown'}</div>
                    </td>
                    <td>{item.service}{item.environment ? ` · ${item.environment}` : ''}</td>
                    <td>{when(item.starts_at)} – {when(item.ends_at)}</td>
                    <td>{item.can_decide ? 'Needs your decision' : statusLabel(item.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      </div>
    </DevOpsLayout>
  );
}
