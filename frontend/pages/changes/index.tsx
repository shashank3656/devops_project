import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { SITE_NAME } from '../../lib/site';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface ChangeRow {
  id: number;
  change_number: string;
  project_name?: string;
  project_code?: string;
  service: string;
  environment: string;
  repo: string;
  pr_number: number;
  sha: string;
  title: string;
  status: string;
  change_type: string;
  linked_incidents: number;
  assignee_username?: string;
  priority?: string;
}

function parseProjectID(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export default function UserChangesCatalogPage() {
  const router = useRouter();
  const [items, setItems] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const projectID = parseProjectID(router.query.project_id);
  const environment = Array.isArray(router.query.environment) ? router.query.environment[0] : router.query.environment || '';

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    const params = new URLSearchParams();
    if (projectID) params.set('project_id', String(projectID));
    if (environment) params.set('environment', environment);
    if (statusFilter) params.set('status', statusFilter);
    if (typeFilter) params.set('change_type', typeFilter);
    if (query.trim()) params.set('q', query.trim());
    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/me/changes?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
          return;
        }
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load changes');
        }
        setItems(Array.isArray(data?.changes) ? data.changes : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load changes'))
      .finally(() => setLoading(false));
  }, [router, projectID, environment, statusFilter, typeFilter]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.change_number} ${item.repo} ${item.title} ${item.service} ${item.sha}`
        .toLowerCase()
        .includes(needle),
    );
  }, [items, query]);

  return (
    <>
      <Head>
        <title>Changes - {SITE_NAME}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Change requests</h1>
            <p className="portal-page__subtitle">
              Deploys recorded for the projects you can access. Pipelines create these rows when code merges to main.
            </p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-stat-grid notification-summary-grid">
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Changes</span>
            <span className="portal-stat-card__value">{items.length}</span>
            <p className="portal-stat-card__copy">Deploys on your visible projects.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Watching</span>
            <span className="portal-stat-card__value">{items.filter((item) => item.status === 'monitoring' || item.status === 'implemented').length}</span>
            <p className="portal-stat-card__copy">Recently shipped changes still being watched.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Failed</span>
            <span className="portal-stat-card__value">{items.filter((item) => item.status === 'failed').length}</span>
            <p className="portal-stat-card__copy">Failed changes on your projects.</p>
          </article>
        </section>
        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Catalog</span>
              <h2 className="portal-surface__title">Your project changes</h2>
            </div>
            <div className="devops-incident-filter-row">
              <input className="input" placeholder="Search repo, title, SHA" value={query} onChange={(event) => setQuery(event.target.value)} />
              <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All status</option>
                <option value="new">New</option>
                <option value="implementing">Implementing</option>
                <option value="implemented">Implemented</option>
                <option value="monitoring">Monitoring</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="">All types</option>
                <option value="standard">Standard</option>
                <option value="normal">Normal</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Loading changes...</div>
          ) : visible.length === 0 ? (
            <div className="empty-state">No change requests for your projects yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Change</th>
                    <th>Repo / PR</th>
                    <th>Service</th>
                    <th>Env</th>
                    <th>Assigned to</th>
                    <th>Priority</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Incidents</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => void router.push(`/changes/${item.id}`)}>
                      <td>
                        <strong>{item.change_number || `CHG${String(item.id).padStart(7, '0')}`}</strong>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.title || item.sha}</div>
                      </td>
                      <td>
                        {item.repo}
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                          {item.pr_number ? `PR #${item.pr_number}` : 'No PR'} · {(item.sha || '').slice(0, 7)}
                        </div>
                      </td>
                      <td>{item.service || '—'}</td>
                      <td>{item.environment === 'unspecified' ? '—' : item.environment}</td>
                      <td>{item.assignee_username || '—'}</td>
                      <td>{item.priority || 'medium'}</td>
                      <td>{item.change_type}</td>
                      <td>{item.status}</td>
                      <td>{item.linked_incidents || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
