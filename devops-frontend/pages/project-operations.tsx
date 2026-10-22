import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';
import { asRecord, getString } from '../lib/payload';

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

function normalizeProjectAnalytics(value: Partial<ProjectAnalytics> | null | undefined): ProjectAnalytics | null {
  if (!value || !value.summary) {
    return null;
  }
  return {
    summary: value.summary,
    environment_request_distribution: Array.isArray(value.environment_request_distribution) ? value.environment_request_distribution : [],
    cloud_request_distribution: Array.isArray(value.cloud_request_distribution) ? value.cloud_request_distribution : [],
    service_request_distribution: Array.isArray(value.service_request_distribution) ? value.service_request_distribution : [],
    risk_distribution: Array.isArray(value.risk_distribution) ? value.risk_distribution : [],
    lead_time: value.lead_time || {
      average_hours: 0,
      completed_requests: 0,
    },
    top_projects_by_requests: Array.isArray(value.top_projects_by_requests) ? value.top_projects_by_requests : [],
    approval_bottlenecks: Array.isArray(value.approval_bottlenecks) ? value.approval_bottlenecks : [],
    top_risk_projects: Array.isArray(value.top_risk_projects) ? value.top_risk_projects : [],
  };
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
        const payload = asRecord(await res.json().catch(() => ({})));
        if (!res.ok) {
          throw new Error(getString(payload.error, 'Failed to load project operations'));
        }
        return payload;
      })
      .then((payload) => {
        const data = asRecord(payload);
        const nextAnalytics = normalizeProjectAnalytics(data.analytics as Partial<ProjectAnalytics> | null | undefined);
        if (nextAnalytics) setAnalytics(nextAnalytics);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [apiUrl]);

  const summary = analytics?.summary;
  const topServices = useMemo(() => (analytics?.service_request_distribution || []).slice(0, 6), [analytics]);
  const topClouds = useMemo(() => (analytics?.cloud_request_distribution || []).slice(0, 4), [analytics]);
  const riskMix = useMemo(() => analytics?.risk_distribution || [], [analytics]);
  const environmentPressure = analytics?.environment_request_distribution || [];
  const approvalBottlenecks = analytics?.approval_bottlenecks || [];
  const topRiskProjects = analytics?.top_risk_projects || [];
  const topProjectsByRequests = analytics?.top_projects_by_requests || [];
  const leadTimeAverage = analytics?.lead_time?.average_hours || 0;

  return (
    <DevOpsLayout>
      <Head>
        <title>Project Operations - OpsTrellis</title>
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
            <Link href="/service-heatmap" className="btn btn-secondary">Service heatmap</Link>
            <Link href="/incidents" className="btn btn-secondary">Incidents</Link>
            <Link href="/runbooks" className="btn btn-secondary">Runbooks</Link>
            <Link href="/tickets" className="btn btn-secondary">Tickets</Link>
            <button type="button" className="btn btn-secondary" onClick={() => void exportProjects()} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            <Link href="/approval-sla" className="btn btn-secondary">Approval SLA</Link>
            <Link href="/approval-center" className="btn btn-primary">Approval center</Link>
          </div>
        </div>

        {loading ? <div className="portal-surface"><div className="empty-state">Loading project operations...</div></div> : null}
        {error ? <div className="alert alert-error">{error}</div> : null}

        {!loading && !error && analytics && summary ? (
          <>
            <section className="portal-surface project-operations__surface-gap">
              <div className="portal-pill-row">
                <span className="portal-pill">Pending requests {summary.pending_request_count}</span>
                <span className="portal-pill">Needs setup {summary.needs_setup_count}</span>
                <span className="portal-pill">Mapped teams {summary.mapped_team_count}</span>
                <span className="portal-pill">Lead time {leadTimeAverage.toFixed(1)}h</span>
              </div>
            </section>

            <div className="portal-grid project-operations__grid">
              <section className="portal-surface">
                <div className="portal-surface__header">
                  <div>
                    <span className="portal-surface__eyebrow">Approvals</span>
                    <h2 className="portal-surface__title">Bottlenecks and risk</h2>
                  </div>
                </div>
                <div className="project-operations__pill-row">
                  {riskMix.map((item) => (
                    <span key={`risk-${item.key}`} className="portal-pill">{item.label}: {item.count}</span>
                  ))}
                </div>
                <div className="project-operations__table-wrap">
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
                      {approvalBottlenecks.map((project) => (
                        <tr key={`bottleneck-${project.id}`}>
                          <td>
                            <strong>{project.name}</strong>
                            <div className="project-operations__meta project-operations__meta--minor">{project.code}</div>
                          </td>
                          <td>{project.pending}</td>
                          <td>{project.completed}</td>
                          <td>{project.teams}</td>
                          <td>
                            <div className="project-operations__action-row">
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
                <div className="project-operations__stack">
                  <div className="project-operations__section">
                    <strong>Service demand</strong>
                    <div className="project-operations__pill-row project-operations__pill-row--spaced">
                      {topServices.map((item) => (
                        <span key={`svc-${item.key}`} className="portal-pill">{item.label}: {item.count}</span>
                      ))}
                    </div>
                  </div>
                  <div className="project-operations__section">
                    <strong>Cloud demand</strong>
                    <div className="project-operations__pill-row project-operations__pill-row--spaced">
                      {topClouds.map((item) => (
                        <span key={`cloud-${item.key}`} className="portal-pill">{item.label}: {item.count}</span>
                      ))}
                    </div>
                  </div>
                  <div className="project-operations__section">
                    <strong>Environment pressure</strong>
                    <div className="project-operations__pill-row project-operations__pill-row--spaced">
                      {environmentPressure.map((item) => (
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
              <div className="project-operations__table-wrap">
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
                    {(topRiskProjects.length > 0 ? topRiskProjects : topProjectsByRequests).map((project) => (
                      <tr key={`attention-${project.id}`}>
                        <td>
                          <strong>{project.name}</strong>
                          <div className="project-operations__meta project-operations__meta--minor">{project.code}</div>
                        </td>
                        <td>{project.status}</td>
                        <td>{project.stage}</td>
                        <td>{project.requests}</td>
                        <td>{project.pending}</td>
                        <td>{project.services}</td>
                        <td>
                          <div className="project-operations__action-row">
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
