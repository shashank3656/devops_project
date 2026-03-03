import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import AdminLayout from '../components/AdminLayout';
import PieChart from '../components/PieChart';

const DashboardLineChart = dynamic(() => import('../components/DashboardLineChart'), { ssr: false });

interface DashboardStats {
  total_users: number;
  total_teams: number;
  unverified_users: number;
  requests_this_week: number;
  pending_approval: number;
  at_risk_count?: number;
  date_filter?: {
    from: string;
    to: string;
    total: number;
    by_status: Record<string, number>;
  };
  sla?: { avg_hours: number; completed_count: number };
  team_comparison?: Array<{ team: string; total: number; completed: number; rejected: number; pending: number; rate: number }>;
  trend?: Array<{ date: string; count: number }>;
}

interface ProjectDashboardItem {
  id: number;
  name: string;
  code: string;
  status: string;
  onboarding_stage?: string;
  ready_for_requests?: boolean;
  service_count?: number;
  team_count?: number;
  request_count?: number;
  pending_request_count?: number;
}

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

interface PRRequest {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  pr_url: string;
  status: string;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  rejected: 'Rejected',
  in_progress: 'In progress',
  pending_approval: 'Pending approval',
  pending_devops_approval: 'Pending DevOps',
  draft: 'Draft',
};

const STATUS_COLORS: Record<string, string> = {
  completed: '#059669',
  rejected: '#dc2626',
  in_progress: '#6366f1',
  pending_approval: '#d97706',
  pending_devops_approval: '#0ea5e9',
  draft: '#64748b',
};

export default function AdminDashboard() {
  const router = useRouter();
  const [quickStats, setQuickStats] = useState<DashboardStats | null>(null);
  const [recent, setRecent] = useState<PRRequest[]>([]);
  const [projects, setProjects] = useState<ProjectDashboardItem[]>([]);
  const [projectAnalytics, setProjectAnalytics] = useState<ProjectAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'custom'>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchData();
  }, [token, router, period, customFrom, customTo]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (period !== 'custom') params.set('period', period);
    else if (customFrom) {
      params.set('from', customFrom);
      params.set('to', customTo || customFrom);
    }
    const dashboardUrl = params.toString() ? `${apiUrl}/api/admin/dashboard-stats?${params}` : `${apiUrl}/api/admin/dashboard-stats`;
    try {
      const [dashboardRes, requestsRes, projectAnalyticsRes] = await Promise.all([
        fetch(dashboardUrl, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/api/admin/requests?limit=10`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/api/admin/project-analytics`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (
        dashboardRes.status === 401 ||
        dashboardRes.status === 403 ||
        requestsRes.status === 401 ||
        requestsRes.status === 403 ||
        projectAnalyticsRes.status === 401 ||
        projectAnalyticsRes.status === 403
      ) {
        router.replace('/login');
        return;
      }
      const [dashboardData, requestsData, projectAnalyticsData] = await Promise.all([
        dashboardRes.json().catch(() => ({})),
        requestsRes.json().catch(() => ({})),
        projectAnalyticsRes.json().catch(() => ({})),
      ]);
      if (dashboardData.total_users !== undefined) setQuickStats(dashboardData);
      if (requestsData.requests) setRecent(requestsData.requests);
      if (projectAnalyticsData?.analytics) setProjectAnalytics(projectAnalyticsData.analytics);
      fetch(`${apiUrl}/api/admin/projects`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (Array.isArray(data?.projects)) setProjects(data.projects);
        })
        .catch(() => {});
    } catch (_) {
      setError('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  const dateFilter = quickStats?.date_filter;
  const showPeriodSummary = period === 'custom' ? !!customFrom : true;
  const trend = quickStats?.trend || [];

  const statusSegments = dateFilter?.by_status
    ? ['completed', 'rejected', 'in_progress', 'pending_approval', 'pending_devops_approval', 'draft']
        .filter((k) => (dateFilter.by_status[k] ?? 0) > 0)
        .map((k) => ({
          label: STATUS_LABELS[k] || k.replace(/_/g, ' '),
          value: dateFilter.by_status[k] ?? 0,
          color: STATUS_COLORS[k] || '#64748b',
        }))
    : [];

  const hasStatusData = statusSegments.length > 0;
  const projectSummary = {
    total: projects.length,
    ready: projects.filter((project) => project.ready_for_requests).length,
    active: projects.filter((project) => project.status === 'active').length,
    needsSetup: projects.filter((project) => !project.ready_for_requests && project.status === 'active').length,
  };
  const topProjects = [...projects]
    .sort((left, right) => (right.request_count || 0) - (left.request_count || 0))
    .slice(0, 5);
  const topProjectServices = projectAnalytics?.service_request_distribution.slice(0, 5) || [];
  const topProjectClouds = projectAnalytics?.cloud_request_distribution.slice(0, 4) || [];
  const topProjectRisks = projectAnalytics?.risk_distribution || [];

  return (
    <>
      <Head>
        <title>Dashboard - Admin</title>
      </Head>
      <AdminLayout>
        <div className="portal-page">
          <div className="portal-page__header">
            <div>
              <span className="portal-page__eyebrow">Dashboard</span>
              <h1 className="portal-page__title">Admin Dashboard</h1>
              <p className="portal-page__subtitle">
                Monitor request volume, approval pressure, team output, and SLA posture from one operational surface.
              </p>
            </div>
            <div className="portal-page__actions">
              <Link href="/project-governance" className="btn btn-secondary">
                Project governance
              </Link>
              <Link href="/team-ownership" className="btn btn-secondary">
                Team ownership
              </Link>
              <Link href="/requests" className="btn btn-primary">
                Open requests
              </Link>
            </div>
          </div>

          <section className="portal-surface">
            <div className="portal-surface__header">
              <div>
                <span className="portal-surface__eyebrow">Time Range</span>
                <h2 className="portal-surface__title">Dashboard Filters</h2>
              </div>
            </div>
            <div className="portal-field-grid">
              <div>
                <label className="label">Time range</label>
                <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="input">
                  <option value="today">Today</option>
                  <option value="week">Last 7 days</option>
                  <option value="month">This month</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              {period === 'custom' && (
                <>
                  <div>
                    <label className="label">From</label>
                    <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="input" />
                  </div>
                  <div>
                    <label className="label">To</label>
                    <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="input" />
                  </div>
                </>
              )}
            </div>
          </section>

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <div className="portal-surface">
              <div className="empty-state">Loading dashboard...</div>
            </div>
          ) : (
            <>
              {quickStats && (
                <section className="portal-stat-grid">
                  <article className="portal-stat-card">
                    <span className="portal-stat-card__label">Total users</span>
                    <span className="portal-stat-card__value">{quickStats.total_users}</span>
                    <p className="portal-stat-card__copy">Active identities with portal access.</p>
                  </article>
                  <article className="portal-stat-card">
                    <span className="portal-stat-card__label">Teams</span>
                    <span className="portal-stat-card__value">{quickStats.total_teams}</span>
                    <p className="portal-stat-card__copy">Managed groups across the platform.</p>
                  </article>
                  <article className="portal-stat-card">
                    <span className="portal-stat-card__label">Pending approval</span>
                    <span className="portal-stat-card__value">{quickStats.pending_approval}</span>
                    <p className="portal-stat-card__copy">Requests still waiting on admin action.</p>
                  </article>
                  <article className="portal-stat-card">
                    <span className="portal-stat-card__label">Requests this week</span>
                    <span className="portal-stat-card__value">{quickStats.requests_this_week}</span>
                    <p className="portal-stat-card__copy">New workload entering the queue.</p>
                  </article>
                </section>
              )}

              {projects.length > 0 && (
                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Projects</span>
                      <h2 className="portal-surface__title">Project Governance Snapshot</h2>
                      <p className="portal-surface__subtitle">Track which projects are request-ready and which still need service or team mapping.</p>
                    </div>
                    <Link href="/projects" className="btn btn-secondary btn-sm">
                      Open projects
                    </Link>
                  </div>

                  <div className="portal-stat-grid" style={{ marginBottom: 20 }}>
                    <article className="portal-stat-card">
                      <span className="portal-stat-card__label">Projects</span>
                      <span className="portal-stat-card__value">{projectSummary.total}</span>
                      <p className="portal-stat-card__copy">Total project catalogs under governance.</p>
                    </article>
                    <article className="portal-stat-card">
                      <span className="portal-stat-card__label">Ready</span>
                      <span className="portal-stat-card__value">{projectSummary.ready}</span>
                      <p className="portal-stat-card__copy">Projects ready for live user requests.</p>
                    </article>
                    <article className="portal-stat-card">
                      <span className="portal-stat-card__label">Needs setup</span>
                      <span className="portal-stat-card__value">{projectSummary.needsSetup}</span>
                      <p className="portal-stat-card__copy">Active projects still missing final onboarding setup.</p>
                    </article>
                    <article className="portal-stat-card">
                      <span className="portal-stat-card__label">Active</span>
                      <span className="portal-stat-card__value">{projectSummary.active}</span>
                      <p className="portal-stat-card__copy">Projects available to the platform right now.</p>
                    </article>
                  </div>

                  {topProjects.length > 0 && (
                    <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Project</th>
                            <th>Stage</th>
                            <th>Requests</th>
                            <th>Pending</th>
                            <th>Teams</th>
                            <th>Services</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {topProjects.map((project) => (
                            <tr key={project.id}>
                              <td>
                                <strong>{project.name}</strong>
                                <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{project.code}</div>
                              </td>
                              <td>{project.onboarding_stage || 'configured'}</td>
                              <td>{project.request_count || 0}</td>
                              <td>{project.pending_request_count || 0}</td>
                              <td>{project.team_count || 0}</td>
                              <td>{project.service_count || 0}</td>
                              <td>
                                <Link href={`/projects/${project.id}`} className="btn btn-secondary btn-sm">
                                  View
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}

              {projectAnalytics && (
                <section className="portal-grid">
                  <article className="portal-surface">
                    <div className="portal-surface__header">
                      <div>
                        <span className="portal-surface__eyebrow">Governance</span>
                        <h2 className="portal-surface__title">Project Analytics</h2>
                        <p className="portal-surface__subtitle">Readiness, mapped user coverage, and cross-project request behavior.</p>
                      </div>
                    </div>
                    <div className="portal-stat-grid" style={{ marginTop: 0 }}>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Mapped users</span>
                        <span className="portal-stat-card__value">{projectAnalytics.summary.active_user_count}</span>
                        <p className="portal-stat-card__copy">Users currently covered by project-team mappings.</p>
                      </article>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Mapped teams</span>
                        <span className="portal-stat-card__value">{projectAnalytics.summary.mapped_team_count}</span>
                        <p className="portal-stat-card__copy">Teams actively attached to project catalogs.</p>
                      </article>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Lead time</span>
                        <span className="portal-stat-card__value">{projectAnalytics.lead_time.average_hours ? `${projectAnalytics.lead_time.average_hours.toFixed(1)}h` : 'n/a'}</span>
                        <p className="portal-stat-card__copy">Average completion lead time across {projectAnalytics.lead_time.completed_requests} completed project requests.</p>
                      </article>
                      <article className="portal-stat-card">
                        <span className="portal-stat-card__label">Archived</span>
                        <span className="portal-stat-card__value">{projectAnalytics.summary.archived_count}</span>
                        <p className="portal-stat-card__copy">Projects currently removed from active request traffic.</p>
                      </article>
                    </div>
                  </article>

                  <article className="portal-surface">
                    <div className="portal-surface__header">
                      <div>
                        <span className="portal-surface__eyebrow">Demand</span>
                        <h2 className="portal-surface__title">Top service demand</h2>
                        <p className="portal-surface__subtitle">Most frequently requested cloud-service combinations across projects.</p>
                      </div>
                    </div>
                    <div className="portal-selection-bar" style={{ marginBottom: 16 }}>
                      <span className="portal-selection-bar__count">Cloud demand: {topProjectClouds.map((item) => `${item.label} ${item.count}`).join(' · ') || 'No request traffic yet'}</span>
                    </div>
                    <div className="portal-selection-bar" style={{ marginBottom: 16 }}>
                      <span className="portal-selection-bar__count">Risk mix: {topProjectRisks.map((item) => `${item.label} ${item.count}`).join(' · ') || 'No risk signals yet'}</span>
                    </div>
                    {topProjectServices.length === 0 ? (
                      <div className="empty-state">No project request traffic available yet.</div>
                    ) : (
                      <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Service</th>
                              <th>Requests</th>
                            </tr>
                          </thead>
                          <tbody>
                            {topProjectServices.map((item) => (
                              <tr key={`svc-${item.key}`}>
                                <td>{item.label}</td>
                                <td>{item.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </article>
                </section>
              )}

              <section className="portal-grid">
                <article className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Trends</span>
                      <h2 className="portal-surface__title">Request Trends</h2>
                    </div>
                  </div>
                  <DashboardLineChart data={trend} />
                </article>
                <article className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Status</span>
                      <h2 className="portal-surface__title">Request Status</h2>
                      {dateFilter && (
                        <p className="portal-surface__subtitle">
                          {dateFilter.from === dateFilter.to ? dateFilter.from : `${dateFilter.from} to ${dateFilter.to}`} / {dateFilter.total} requests
                        </p>
                      )}
                    </div>
                  </div>
                  <PieChart title="" segments={statusSegments} emptyMessage="No requests in this period" />
                </article>
              </section>

              {(showPeriodSummary && dateFilter) && (
                <section className="portal-surface">
                  <div className="portal-surface__header">
                    <div>
                      <span className="portal-surface__eyebrow">Summary</span>
                      <h2 className="portal-surface__title">Dashboard Summary</h2>
                      <p className="portal-surface__subtitle">
                        {dateFilter.from === dateFilter.to ? dateFilter.from : `${dateFilter.from} to ${dateFilter.to}`} / {dateFilter.total} requests
                      </p>
                    </div>
                  </div>
                  {!hasStatusData && <div className="empty-state">No requests landed in the selected period.</div>}
                  {quickStats?.sla && quickStats.sla.completed_count > 0 && (
                    <div className="portal-selection-bar">
                      <span className="portal-selection-bar__count">
                        Average time to complete: {quickStats.sla.avg_hours.toFixed(1)}h across {quickStats.sla.completed_count} completed requests.
                      </span>
                    </div>
                  )}
                </section>
              )}

              {quickStats?.team_comparison && quickStats.team_comparison.length > 0 && (
                <section className="portal-surface portal-surface--table">
                  <div className="portal-surface__header" style={{ padding: 24, marginBottom: 0 }}>
                    <div>
                      <span className="portal-surface__eyebrow">Teams</span>
                      <h2 className="portal-surface__title">Team Comparison</h2>
                    </div>
                  </div>
                  <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Team</th>
                          <th>Total</th>
                          <th>Completed</th>
                          <th>Rejected</th>
                          <th>Pending</th>
                          <th>Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quickStats.team_comparison.map((team) => (
                          <tr key={team.team}>
                            <td><strong>{team.team}</strong></td>
                            <td>{team.total}</td>
                            <td>{team.completed}</td>
                            <td>{team.rejected}</td>
                            <td>{team.pending}</td>
                            <td>{team.rate.toFixed(0)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section className="portal-surface portal-surface--table">
                <div className="portal-surface__header" style={{ padding: 24, marginBottom: 0 }}>
                  <div>
                    <span className="portal-surface__eyebrow">Requests</span>
                    <h2 className="portal-surface__title">Recent Requests</h2>
                  </div>
                </div>
                {recent.length === 0 ? (
                  <div className="empty-state" style={{ padding: 24 }}>No PR requests yet.</div>
                ) : (
                  <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Team</th>
                          <th>Env</th>
                          <th>Cloud</th>
                          <th>Service</th>
                          <th>Status</th>
                          <th>Created</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {recent.map((req) => (
                          <tr key={req.id}>
                            <td>{req.id}</td>
                            <td>{req.team}</td>
                            <td>{req.env}</td>
                            <td>{req.cloud}</td>
                            <td>{req.service}</td>
                            <td>
                              <span className="status-badge" data-status={req.status}>
                                {req.status === 'pending_approval'
                                  ? 'Pending approval'
                                  : req.status === 'in_progress'
                                    ? 'In progress'
                                    : req.status === 'completed'
                                      ? 'Completed'
                                      : req.status === 'rejected'
                                        ? 'Rejected'
                                        : req.status}
                              </span>
                            </td>
                            <td>{new Date(req.created_at).toLocaleString()}</td>
                            <td>
                              {req.pr_url ? (
                                <a href={req.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                                  Open PR
                                </a>
                              ) : (
                                <span style={{ color: 'var(--color-text-muted)' }}>-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </AdminLayout>
    </>
  );
}
