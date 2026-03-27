import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AppLayout, { getApiUrl } from '../components/AppLayout';
import { asRecord, getString } from '../lib/payload';
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
  return value.map((incident) => {
    const item = incident && typeof incident === 'object' ? (incident as Record<string, unknown>) : {};
    return {
      id: typeof item.id === 'number' ? item.id : 0,
      incident_number: typeof item.incident_number === 'string' ? item.incident_number : '',
      request_id: typeof item.request_id === 'number' ? item.request_id : 0,
      project_id: typeof item.project_id === 'number' ? item.project_id : null,
      project_name: typeof item.project_name === 'string' ? item.project_name : '',
      project_code: typeof item.project_code === 'string' ? item.project_code : '',
      request_team: typeof item.request_team === 'string' ? item.request_team : '',
      request_env: typeof item.request_env === 'string' ? item.request_env : '',
      request_service: typeof item.request_service === 'string' ? item.request_service : '',
      request_cloud: typeof item.request_cloud === 'string' ? item.request_cloud : '',
      request_status: typeof item.request_status === 'string' ? item.request_status : '',
      team_id: typeof item.team_id === 'number' ? item.team_id : null,
      team_name: typeof item.team_name === 'string' ? item.team_name : '',
      severity: typeof item.severity === 'string' ? item.severity : 'medium',
      status: typeof item.status === 'string' ? item.status : 'open',
      escalation_level: typeof item.escalation_level === 'string' ? item.escalation_level : 'monitoring',
      owner_user_id: typeof item.owner_user_id === 'number' ? item.owner_user_id : null,
      owner_username: typeof item.owner_username === 'string' ? item.owner_username : '',
      summary: typeof item.summary === 'string' ? item.summary : '',
      notes: typeof item.notes === 'string' ? item.notes : '',
      created_at: typeof item.created_at === 'string' ? item.created_at : '',
      updated_at: typeof item.updated_at === 'string' ? item.updated_at : '',
    };
  });
}

function formatTimestamp(value: string): string {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return parsed.toLocaleString();
}

function getIncidentReference(incident: Pick<Incident, 'id' | 'incident_number'>): string {
  return incident.incident_number || `INC${String(incident.id).padStart(7, '0')}`;
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
        const data = asRecord(await res.json().catch(() => ({})));
        if (!res.ok) {
          throw new Error(getString(data.error, 'Failed to load incidents'));
        }
        setIncidents(normalizeIncidents(data.incidents));
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
                          <strong>{getIncidentReference(incident)}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                            {[incident.request_service || 'service', incident.request_env || '', incident.request_cloud || '']
                              .filter(Boolean)
                              .join(' · ')}
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
