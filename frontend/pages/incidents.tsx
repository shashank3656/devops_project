import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { asRecord, getString } from '../lib/payload';
import { PageFilters } from '@infragate/ui';
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
  team_name?: string;
  severity: string;
  status: string;
  owner_username?: string;
  summary: string;
  notes: string;
  source?: string;
  fingerprint?: string;
  suspected_change_id?: number;
  suspected_change_number?: string;
  service?: string;
  environment?: string;
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
      team_name: typeof item.team_name === 'string' ? item.team_name : '',
      severity: typeof item.severity === 'string' ? item.severity : 'medium',
      status: typeof item.status === 'string' ? item.status : 'open',
      owner_username: typeof item.owner_username === 'string' ? item.owner_username : '',
      summary: typeof item.summary === 'string' ? item.summary : '',
      notes: typeof item.notes === 'string' ? item.notes : '',
      source: typeof item.source === 'string' ? item.source : 'ticket',
      fingerprint: typeof item.fingerprint === 'string' ? item.fingerprint : '',
      suspected_change_id: typeof item.suspected_change_id === 'number' ? item.suspected_change_id : undefined,
      suspected_change_number: typeof item.suspected_change_number === 'string' ? item.suspected_change_number : '',
      service: typeof item.service === 'string' ? item.service : '',
      environment: typeof item.environment === 'string' ? item.environment : '',
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

function parseProjectID(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export default function UserIncidentsPage() {
  const router = useRouter();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeStatus, setActiveStatus] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const projectID = parseProjectID(router.query.project_id);
  const environment = Array.isArray(router.query.environment) ? router.query.environment[0] : router.query.environment || '';

  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      if (activeStatus !== 'all' && incident.status !== activeStatus) return false;
      if (sourceFilter !== 'all' && (incident.source || 'ticket') !== sourceFilter) return false;
      return true;
    });
  }, [activeStatus, incidents, sourceFilter]);

  const openCount = useMemo(() => incidents.filter((incident) => incident.status !== 'resolved' && incident.status !== 'closed').length, [incidents]);
  const criticalCount = useMemo(() => incidents.filter((incident) => incident.severity === 'critical' || incident.severity === 'high').length, [incidents]);

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
        const params = new URLSearchParams();
        if (projectID) params.set('project_id', String(projectID));
        if (environment) params.set('environment', environment);
        const res = await fetch(`${apiUrl}/api/me/incidents?${params.toString()}`, {
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
  }, [apiUrl, router, projectID, environment]);

  return (
    <>
      <Head>
        <title>Incidents - {SITE_NAME}</title>
      </Head>

      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Incidents</h1>
            <p className="portal-page__subtitle">
              Alert, ticket, and change-regression incidents assigned to you or on your projects.
            </p>
          </div>
        </div>

        <section className="portal-stat-grid notification-summary-grid">
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Visible</span>
            <span className="portal-stat-card__value">{incidents.length}</span>
            <p className="portal-stat-card__copy">Incidents on your projects plus ones assigned to you.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">Active</span>
            <span className="portal-stat-card__value">{openCount}</span>
            <p className="portal-stat-card__copy">Incidents that still need attention or follow-up.</p>
          </article>
          <article className="portal-stat-card">
            <span className="portal-stat-card__label">High / critical</span>
            <span className="portal-stat-card__value">{criticalCount}</span>
            <p className="portal-stat-card__copy">Highest-severity incidents in this catalog.</p>
          </article>
        </section>

        {error ? <div className="alert alert-error">{error}</div> : null}
        <PageFilters
          chips={[
            projectID ? { key: 'project', label: 'Project', value: String(projectID) } : null,
            environment ? { key: 'environment', label: 'Environment', value: environment } : null,
          ].filter((chip): chip is { key: string; label: string; value: string } => Boolean(chip))}
        />

        <section className="portal-surface">
          <div className="portal-surface__header">
            <div>
              <span className="portal-surface__eyebrow">Catalog</span>
              <h2 className="portal-surface__title">Incident workload</h2>
              <p className="portal-surface__subtitle">Filter by status or source to find alerts, tickets, or regressions.</p>
            </div>
            <div className="ig-filter-bar">
              <select
                className="input incidents-page__filter"
                value={activeStatus}
                onChange={(event) => setActiveStatus(event.target.value)}
              >
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="investigating">Investigating</option>
                <option value="mitigating">Mitigating</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                className="input incidents-page__filter"
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
              >
                <option value="all">All sources</option>
                <option value="alert">Alert</option>
                <option value="ticket">Ticket</option>
                <option value="change_regression">Change regression</option>
                <option value="manual">Manual</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="empty-state">Loading incidents...</div>
          ) : filteredIncidents.length === 0 ? (
            <div className="empty-state">No incidents match the current filter.</div>
          ) : (
            <div className="incidents-page__table-wrap">
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>Source</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Project</th>
                    <th>Change</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredIncidents.map((incident) => (
                    <tr key={incident.id} style={{ cursor: 'pointer' }} onClick={() => void router.push(`/incidents/${incident.id}`)}>
                      <td>
                        <div>
                          <strong>{getIncidentReference(incident)}</strong>
                          <div className="incidents-page__meta">
                            {[incident.service || incident.request_service || 'service', incident.environment || incident.request_env || '']
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                          <div className="incidents-page__notes">{incident.summary || 'No summary yet'}</div>
                        </div>
                      </td>
                      <td>{incident.source || 'ticket'}</td>
                      <td>{incident.severity}</td>
                      <td>{incident.status}</td>
                      <td>{incident.project_name ? `${incident.project_name} (${incident.project_code})` : 'No project'}</td>
                      <td>{incident.suspected_change_number || '—'}</td>
                      <td>{formatTimestamp(incident.updated_at)}</td>
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
