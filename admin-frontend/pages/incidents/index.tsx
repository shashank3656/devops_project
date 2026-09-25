import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import AdminLayout from '../../components/AdminLayout';
import { ADMIN_SITE_NAME } from '../../lib/site';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface IncidentRow {
  id: number;
  incident_number?: string;
  request_id?: number;
  project_name?: string;
  project_code?: string;
  severity: string;
  status: string;
  summary: string;
  source?: string;
  fingerprint?: string;
  suspected_change_number?: string;
  request_env?: string;
  environment?: string;
  service?: string;
  request_service?: string;
  owner_username?: string;
  updated_at: string;
}

function parseProjectID(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export default function AdminIncidentsCatalogPage() {
  const router = useRouter();
  const [items, setItems] = useState<IncidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const projectID = parseProjectID(router.query.project_id);
  const environment = Array.isArray(router.query.environment) ? router.query.environment[0] : router.query.environment || '';

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    const params = new URLSearchParams();
    if (projectID) params.set('project_id', String(projectID));
    if (environment) params.set('environment', environment);
    if (statusFilter) params.set('status', statusFilter);
    if (sourceFilter) params.set('source', sourceFilter);
    if (query.trim()) params.set('q', query.trim());
    setLoading(true);
    setError('');
    fetch(`${apiUrl}/api/admin/incidents?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load incidents');
        }
        setItems(Array.isArray(data?.incidents) ? data.incidents : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load incidents'))
      .finally(() => setLoading(false));
  }, [router, projectID, environment, statusFilter, sourceFilter]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.incident_number} ${item.summary} ${item.source} ${item.fingerprint} ${item.suspected_change_number}`
        .toLowerCase()
        .includes(needle),
    );
  }, [items, query]);

  return (
    <AdminLayout>
      <Head>
        <title>Incidents - {ADMIN_SITE_NAME}</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Incidents</h1>
            <p className="portal-page__subtitle">
              Alert, ticket, and change-regression incidents. This catalog is read-only in Admin — DevOps owns the queue.
            </p>
          </div>
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <section className="portal-stat-grid notification-summary-grid">
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Incidents</span>
            <span className="portal-stat-card__value">{items.length}</span>
            <p className="portal-stat-card__copy">Visible in the current project and environment scope.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Open</span>
            <span className="portal-stat-card__value">{items.filter((item) => item.status !== 'resolved' && item.status !== 'closed').length}</span>
            <p className="portal-stat-card__copy">Incidents that still need attention.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Critical</span>
            <span className="portal-stat-card__value">{items.filter((item) => item.severity === 'critical' || item.severity === 'high').length}</span>
            <p className="portal-stat-card__copy">High and critical severity in this list.</p>
          </article>
        </section>
        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Catalog</span>
              <h2 className="portal-surface__title">Open and recent incidents</h2>
            </div>
            <div className="ig-filter-bar devops-incident-filter-row">
              <input className="input" placeholder="Search number, summary, fingerprint" value={query} onChange={(event) => setQuery(event.target.value)} />
              <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All status</option>
                <option value="open">Open</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="investigating">Investigating</option>
                <option value="mitigating">Mitigating</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select className="input" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                <option value="">All sources</option>
                <option value="alert">Alert</option>
                <option value="ticket">Ticket</option>
                <option value="change_regression">Change regression</option>
                <option value="manual">Manual</option>
              </select>
            </div>
          </div>
          {loading ? (
            <div className="empty-state">Loading incidents...</div>
          ) : visible.length === 0 ? (
            <div className="empty-state">No incidents in this scope yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>Source</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Service</th>
                    <th>Change</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => void router.push(`/incidents/${item.id}`)}>
                      <td>
                        <strong>{item.incident_number || `INC${String(item.id).padStart(7, '0')}`}</strong>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{item.summary || 'No summary'}</div>
                      </td>
                      <td>{item.source || 'ticket'}</td>
                      <td>{item.severity}</td>
                      <td>{item.status}</td>
                      <td>{item.service || item.request_service || '—'}</td>
                      <td>{item.suspected_change_number || '—'}</td>
                      <td>{item.owner_username || 'Unassigned'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
