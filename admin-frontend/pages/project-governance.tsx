import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../components/AdminLayout';

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
  stage_distribution: ProjectAnalyticsDistributionItem[];
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

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export default function AdminProjectGovernancePage() {
  const router = useRouter();
  const [analytics, setAnalytics] = useState<ProjectAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const exportProjects = async () => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    setExporting(true);
    try {
      const response = await fetch(`${apiUrl}/api/admin/projects?format=csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        router.replace('/login');
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to export projects');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'admin-project-governance.csv';
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
    const token = localStorage.getItem('admin_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/admin/project-analytics`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          router.replace('/login');
          return null;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load project governance analytics');
        }
        return data;
      })
      .then((data) => {
        if (data?.analytics) setAnalytics(data.analytics);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  const summary = analytics?.summary;
  const topServices = useMemo(() => (analytics?.service_request_distribution || []).slice(0, 6), [analytics]);
  const topClouds = useMemo(() => (analytics?.cloud_request_distribution || []).slice(0, 4), [analytics]);
  const riskMix = useMemo(() => analytics?.risk_distribution || [], [analytics]);

  return (
    <>
      <Head>
        <title>Project Governance - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Governance</span>
              <h1 className="portal-page__title">Project Governance</h1>
              <p className="portal-page__subtitle">
                Review readiness, risk, approval bottlenecks, and request concentration across the full project estate.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/projects" className="btn btn-secondary">Projects</Link>
              <Link href="/access-review" className="btn btn-secondary">Access review</Link>
              <button type="button" className="btn btn-secondary" onClick={() => void exportProjects()} disabled={exporting}>
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
              <Link href="/notifications" className="btn btn-primary">Open notifications</Link>
            </div>
          </div>

          {loading ? <div className="portal-surface"><div className="empty-state">Loading governance analytics...</div></div> : null}
          {error ? <div className="alert alert-error">{error}</div> : null}

          {!loading && !error && analytics && summary ? (
            <>
              <section className="portal-stat-grid">
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Projects</span>
                  <span className="portal-stat-card__value">{summary.project_count}</span>
                  <p className="portal-stat-card__copy">Projects currently tracked in the project-first delivery model.</p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Ready</span>
                  <span className="portal-stat-card__value">{summary.ready_count}</span>
                  <p className="portal-stat-card__copy">Project catalogs ready for user request intake.</p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Need setup</span>
                  <span className="portal-stat-card__value">{summary.needs_setup_count}</span>
                  <p className="portal-stat-card__copy">Projects still missing access, service mapping, or final readiness.</p>
                </article>
                <article className="portal-stat-card">
                  <span className="portal-stat-card__label">Lead time</span>
                  <span className="portal-stat-card__value">{analytics.lead_time.average_hours.toFixed(1)}h</span>
                  <p className="portal-stat-card__copy">Average completion lead time across completed requests.</p>
                </article>
              </section>

              <div className="portal-grid" style={{ alignItems: 'start' }}>
                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Risk</span>
                      <h2 className="portal-surface__title">Risk and approval pressure</h2>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {riskMix.length === 0 ? (
                        <span className="portal-pill">No risk signals yet</span>
                      ) : (
                        riskMix.map((item) => (
                          <span key={item.key} className="portal-pill">
                            {item.label}: {item.count}
                          </span>
                        ))
                      )}
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="templates-table">
                        <thead>
                          <tr>
                            <th>Project</th>
                            <th>Stage</th>
                            <th>Pending</th>
                            <th>Completed</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(analytics.top_risk_projects.length > 0 ? analytics.top_risk_projects : analytics.approval_bottlenecks).slice(0, 6).map((project) => (
                            <tr key={`risk-${project.id}`}>
                              <td>
                                <strong>{project.name}</strong>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{project.code}</div>
                              </td>
                              <td>{project.stage}</td>
                              <td>{project.pending}</td>
                              <td>{project.completed}</td>
                              <td><Link href={`/projects/${project.id}`} className="btn btn-secondary btn-sm">Inspect</Link></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>

                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Demand</span>
                      <h2 className="portal-surface__title">Demand profile</h2>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 18 }}>
                    <div>
                      <strong>Top services</strong>
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
                    <span className="portal-surface__eyebrow">Top Projects</span>
                    <h2 className="portal-surface__title">Highest request volume</h2>
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
                        <th>Teams</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.top_projects_by_requests.map((project) => (
                        <tr key={`top-project-${project.id}`}>
                          <td>
                            <strong>{project.name}</strong>
                            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{project.code}</div>
                          </td>
                          <td>{project.status}</td>
                          <td>{project.stage}</td>
                          <td>{project.requests}</td>
                          <td>{project.pending}</td>
                          <td>{project.services}</td>
                          <td>{project.teams}</td>
                          <td><Link href={`/projects/${project.id}`} className="btn btn-secondary btn-sm">Open</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </AdminLayout>
    </>
  );
}
