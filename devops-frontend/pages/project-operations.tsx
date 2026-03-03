import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';
const DEVOPS_USER_KEY = 'devops_user';

interface ProjectAnalyticsDistributionItem {
  key: string;
  label: string;
  count: number;
}

interface ProjectAnalyticsProjectItem {
  id: number;
  name: string;
  code: string;
  status: string;
  stage: string;
  requests: number;
  pending: number;
  completed: number;
  services: number;
  teams: number;
}

interface ProjectAnalytics {
  summary: {
    project_count: number;
    ready_count: number;
    needs_setup_count: number;
    archived_count: number;
    total_request_count: number;
    pending_request_count: number;
    completed_request_count: number;
    active_user_count: number;
    mapped_team_count: number;
  };
  environment_request_distribution: ProjectAnalyticsDistributionItem[];
  cloud_request_distribution: ProjectAnalyticsDistributionItem[];
  service_request_distribution: ProjectAnalyticsDistributionItem[];
  risk_distribution: ProjectAnalyticsDistributionItem[];
  lead_time: {
    average_hours: number;
    completed_requests: number;
  };
  top_projects_by_requests: ProjectAnalyticsProjectItem[];
  approval_bottlenecks: ProjectAnalyticsProjectItem[];
  top_risk_projects: ProjectAnalyticsProjectItem[];
}

export default function DevOpsProjectOperationsPage() {
  const apiUrl = useApiUrl();
  const [analytics, setAnalytics] = useState<ProjectAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const clearSessionAndRedirect = () => {
    localStorage.removeItem(DEVOPS_TOKEN_KEY);
    localStorage.removeItem(DEVOPS_USER_KEY);
    window.location.assign('/login');
  };

  const exportProjects = async () => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    if (!token) {
      clearSessionAndRedirect();
      return;
    }
    setExporting(true);
    try {
      const response = await fetch(`${apiUrl}/api/devops/projects?format=csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        clearSessionAndRedirect();
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to export projects');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'devops-project-operations.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export projects';
      setError(message);
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem(DEVOPS_TOKEN_KEY);
    const rawUser = localStorage.getItem(DEVOPS_USER_KEY);
    if (!token || !rawUser) {
      clearSessionAndRedirect();
      return;
    }
    fetch(`${apiUrl}/api/devops/project-analytics`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          clearSessionAndRedirect();
          return null;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load project operations');
        }
        return data;
      })
      .then((data) => {
        if (data?.analytics) setAnalytics(data.analytics);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  const summary = analytics?.summary;
  const topServices = useMemo(() => (analytics?.service_request_distribution || []).slice(0, 6), [analytics]);
  const topClouds = useMemo(() => (analytics?.cloud_request_distribution || []).slice(0, 4), [analytics]);
  const riskMix = useMemo(() => analytics?.risk_distribution || [], [analytics]);

  return (
    <DevOpsLayout>
      <Head>
        <title>Project Operations - DevOps Portal</title>
      </Head>
      <div className="portal-page">
        <div className="portal-page__header">
          <div>
            <span className="portal-page__eyebrow">Operations</span>
            <h1 className="portal-page__title">Project Operations</h1>
            <p className="portal-page__subtitle">
              Focus on projects needing action, approval bottlenecks, service demand, and readiness pressure across delivery.
            </p>
          </div>
          <div className="portal-page__actions">
            <Link href="/projects" className="btn btn-secondary">Projects</Link>
            <Link href="/tickets" className="btn btn-secondary">Tickets</Link>
            <button type="button" className="btn btn-secondary" onClick={() => void exportProjects()} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            <Link href="/approval-center" className="btn btn-primary">Approval center</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading project operations...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}

        {!loading && !error && analytics && summary ? (
          <>
            <section className="portal-stat-grid">
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Pending requests</span>
                <span className="portal-stat-card__value">{summary.pending_request_count}</span>
                <p className="portal-stat-card__copy">All project-scoped requests still waiting for delivery or approval action.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Needs setup</span>
                <span className="portal-stat-card__value">{summary.needs_setup_count}</span>
                <p className="portal-stat-card__copy">Projects missing enough configuration to safely accept steady request flow.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Mapped teams</span>
                <span className="portal-stat-card__value">{summary.mapped_team_count}</span>
                <p className="portal-stat-card__copy">Teams currently consuming project-scoped services and environments.</p>
              </article>
              <article className="portal-stat-card">
                <span className="portal-stat-card__label">Lead time</span>
                <span className="portal-stat-card__value">{analytics.lead_time.average_hours.toFixed(1)}h</span>
                <p className="portal-stat-card__copy">Average completion time for delivered project requests.</p>
              </article>
            </section>

            <div className="portal-grid" style={{ alignItems: 'start' }}>
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Approvals</span>
                    <h2 className="portal-surface__title">Bottlenecks and risk</h2>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                  {riskMix.map((item) => (
                    <span key={`risk-${item.key}`} className="portal-pill">{item.label}: {item.count}</span>
                  ))}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="templates-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Pending</th>
                        <th>Completed</th>
                        <th>Teams</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.approval_bottlenecks.map((project) => (
                        <tr key={`bottleneck-${project.id}`}>
                          <td>
                            <strong>{project.name}</strong>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{project.code}</div>
                          </td>
                          <td>{project.pending}</td>
                          <td>{project.completed}</td>
                          <td>{project.teams}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <Link href={`/projects/${project.id}`} className="btn btn-secondary btn-sm">Open project</Link>
                              <Link href={`/tickets?project_id=${project.id}`} className="btn btn-secondary btn-sm">Open tickets</Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Demand</span>
                    <h2 className="portal-surface__title">Cloud and service pressure</h2>
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 18 }}>
                  <div>
                    <strong>Service demand</strong>
                    <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {topServices.map((item) => (
                        <span key={`svc-${item.key}`} className="portal-pill">{item.label}: {item.count}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <strong>Cloud demand</strong>
                    <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {topClouds.map((item) => (
                        <span key={`cloud-${item.key}`} className="portal-pill">{item.label}: {item.count}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <strong>Environment pressure</strong>
                    <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {analytics.environment_request_distribution.map((item) => (
                        <span key={`env-${item.key}`} className="portal-pill">{item.label}: {item.count}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <section className="portal-surface">
              <div className="portal-surface__header">
                <div>
                  <span className="portal-surface__eyebrow">Priority</span>
                  <h2 className="portal-surface__title">Projects needing attention</h2>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="templates-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Status</th>
                      <th>Stage</th>
                      <th>Requests</th>
                      <th>Pending</th>
                      <th>Services</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(analytics.top_risk_projects.length > 0 ? analytics.top_risk_projects : analytics.top_projects_by_requests).map((project) => (
                      <tr key={`attention-${project.id}`}>
                        <td>
                          <strong>{project.name}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{project.code}</div>
                        </td>
                        <td>{project.status}</td>
                        <td>{project.stage}</td>
                        <td>{project.requests}</td>
                        <td>{project.pending}</td>
                        <td>{project.services}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <Link href={`/projects/${project.id}`} className="btn btn-secondary btn-sm">Inspect</Link>
                            <Link href={`/approval-center?project_id=${project.id}`} className="btn btn-secondary btn-sm">Open approvals</Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </DevOpsLayout>
  );
}
