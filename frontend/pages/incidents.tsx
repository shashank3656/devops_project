import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppLayout, { getApiUrl } from '../components/AppLayout';
import { SITE_NAME } from '../lib/site';

interface Incident {
  id: number;
  incident_number: string;
  request_id: number;
  project_id?: number | null;
  project_name?: string;
  project_code?: string;
  request_team?: string;
  request_env?: string;
  request_service?: string;
  request_cloud?: string;
  request_status?: string;
  team_id?: number | null;
  team_name?: string;
  severity: string;
  status: string;
  escalation_level: string;
  owner_user_id?: number | null;
  owner_username?: string;
  summary: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

function normalizeIncidents(value: unknown): Incident[] {
  if (!Array.isArray(value)) return [];
  return value.map((incident) => ({
    id: typeof incident?.id === 'number' ? incident.id : 0,
    incident_number: typeof incident?.incident_number === 'string' ? incident.incident_number : '',
    request_id: typeof incident?.request_id === 'number' ? incident.request_id : 0,
    project_id: typeof incident?.project_id === 'number' ? incident.project_id : null,
    project_name: typeof incident?.project_name === 'string' ? incident.project_name : '',
    project_code: typeof incident?.project_code === 'string' ? incident.project_code : '',
    request_team: typeof incident?.request_team === 'string' ? incident.request_team : '',
    request_env: typeof incident?.request_env === 'string' ? incident.request_env : '',
    request_service: typeof incident?.request_service === 'string' ? incident.request_service : '',
    request_cloud: typeof incident?.request_cloud === 'string' ? incident.request_cloud : '',
    request_status: typeof incident?.request_status === 'string' ? incident.request_status : '',
    team_id: typeof incident?.team_id === 'number' ? incident.team_id : null,
    team_name: typeof incident?.team_name === 'string' ? incident.team_name : '',
    severity: typeof incident?.severity === 'string' ? incident.severity : 'medium',
    status: typeof incident?.status === 'string' ? incident.status : 'open',
    escalation_level: typeof incident?.escalation_level === 'string' ? incident.escalation_level : 'monitoring',
    owner_user_id: typeof incident?.owner_user_id === 'number' ? incident.owner_user_id : null,
    owner_username: typeof incident?.owner_username === 'string' ? incident.owner_username : '',
    summary: typeof incident?.summary === 'string' ? incident.summary : '',
    notes: typeof incident?.notes === 'string' ? incident.notes : '',
    created_at: typeof incident?.created_at === 'string' ? incident.created_at : '',
    updated_at: typeof incident?.updated_at === 'string' ? incident.updated_at : '',
  }));
}

function formatTimestamp(value: string): string {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return parsed.toLocaleString();
}

export default function UserIncidentsPage() {
  const router = useRouter();
  const apiUrl = getApiUrl();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeStatus, setActiveStatus] = useState('all');

  const filteredIncidents = useMemo(() => {
    if (activeStatus === 'all') return incidents;
    return incidents.filter((incident) => incident.status === activeStatus);
  }, [activeStatus, incidents]);

  const openCount = useMemo(() => incidents.filter((incident) => incident.status !== 'resolved').length, [incidents]);
  const criticalCount = useMemo(() => incidents.filter((incident) => incident.severity === 'critical').length, [incidents]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }

    const fetchIncidents = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${apiUrl}/api/me/incidents`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load incidents');
        }
        setIncidents(normalizeIncidents(data?.incidents));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load incidents');
      } finally {
        setLoading(false);
      }
    };

    void fetchIncidents();
  }, [apiUrl, router]);

  return (
    <AppLayout>
      <Head>
        <title>Incidents - {SITE_NAME}</title>
      </Head>

      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operational Response</span>
            <h1 className="portal-page__title">Assigned Incidents</h1>
            <p className="portal-page__subtitle">
              Review incidents assigned to you, track escalation state, and jump back to the related infrastructure request.
            </p>
          </div>
        </div>

        <section className="portal-stat-grid notification-summary-grid">
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Assigned</span>
            <span className="portal-stat-card__value">{incidents.length}</span>
            <p className="portal-stat-card__copy">Incidents currently assigned to your account.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Active</span>
            <span className="portal-stat-card__value">{openCount}</span>
            <p className="portal-stat-card__copy">Incidents that still need attention or follow-up.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Critical</span>
            <span className="portal-stat-card__value">{criticalCount}</span>
            <p className="portal-stat-card__copy">Critical incidents currently assigned to you.</p>
          </article>
        </section>

        {error ? <div className="alert alert-error">{error}</div> : null}

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Queue</span>
              <h2 className="portal-surface__title">Incident workload</h2>
              <p className="portal-surface__subtitle">Use the status filter to narrow the incidents that need action right now.</p>
            </div>
            <div className="portal-page__actions">
              <label className="label" htmlFor="incident-status-filter">
                Status
              </label>
              <select
                id="incident-status-filter"
                className="input"
                value={activeStatus}
                onChange={(event) => setActiveStatus(event.target.value)}
                style={{ minWidth: 180 }}
              >
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="investigating">Investigating</option>
                <option value="mitigating">Mitigating</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="empty-state">Loading assigned incidents...</div>
          ) : filteredIncidents.length === 0 ? (
            <div className="empty-state">No incidents match the current filter.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>Project</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Team</th>
                    <th>Summary</th>
                    <th>Updated</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIncidents.map((incident) => (
                    <tr key={incident.id}>
                      <td>
                        <div>
                          <strong>{incident.incident_number || `INC${String(incident.id).padStart(7, '0')}`}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                            Request #{incident.request_id} · {incident.request_service || 'service'}
                          </div>
                        </div>
                      </td>
                      <td>{incident.project_name ? `${incident.project_name} (${incident.project_code})` : 'No project'}</td>
                      <td>{incident.severity}</td>
                      <td>{incident.status}</td>
                      <td>{incident.team_name || incident.request_team || 'No team'}</td>
                      <td>
                        <div>
                          <strong>{incident.summary || 'No summary yet'}</strong>
                          {incident.notes ? (
                            <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 6 }}>
                              {incident.notes}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td>{formatTimestamp(incident.updated_at)}</td>
                      <td>
                        <Link href={`/history?id=${incident.request_id}`} className="btn btn-secondary btn-sm">
                          Open request
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
