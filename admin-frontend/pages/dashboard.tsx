import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import AdminLayout from '../components/AdminLayout';
import PieChart from '../components/PieChart';
import { IconUser, IconTeams, IconBell, IconRequests, IconShoppingBag } from '../components/Icons';

const DashboardLineChart = dynamic(() => import('../components/DashboardLineChart'), { ssr: false });

interface Stats {
  total_requests: number;
  by_cloud: Record<string, number>;
  by_status: Record<string, number>;
  by_env: Record<string, number>;
}

interface DashboardStats {
  total_users: number;
  total_teams: number;
  unverified_users: number;
  requests_this_week: number;
  pending_approval: number;
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
  const [stats, setStats] = useState<Stats | null>(null);
  const [quickStats, setQuickStats] = useState<DashboardStats | null>(null);
  const [recent, setRecent] = useState<PRRequest[]>([]);
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
      const [statsRes, dashboardRes, requestsRes] = await Promise.all([
        fetch(`${apiUrl}/api/admin/stats`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(dashboardUrl, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/api/admin/requests?limit=10`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (statsRes.status === 401 || statsRes.status === 403 || requestsRes.status === 401 || requestsRes.status === 403) {
        router.replace('/login');
        return;
      }
      const [statsData, dashboardData, requestsData] = await Promise.all([
        statsRes.json().catch(() => ({})),
        dashboardRes.json().catch(() => ({})),
        requestsData.json().catch(() => ({})),
      ]);
      if (statsData.stats) setStats(statsData.stats);
      if (dashboardData.total_users !== undefined) setQuickStats(dashboardData);
      if (requestsData.requests) setRecent(requestsData.requests);
      if (statsData.error) setError(statsData.error);
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

  return (
    <>
      <Head>
        <title>Dashboard - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container" style={{ maxWidth: 1200 }}>
          <div className="page-header">
            <h1 className="page-title">Analytics Dashboard</h1>
            <Link href="/requests" className="btn btn-primary">
              View all requests
            </Link>
          </div>

          <div className="dashboard-filter-bar">
            <label className="dashboard-filter-label">Time range</label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as typeof period)}
              className="input dashboard-filter-select"
            >
              <option value="today">Today</option>
              <option value="week">Last 7 days</option>
              <option value="month">This month</option>
              <option value="custom">Custom</option>
            </select>
            {period === 'custom' && (
              <>
                <label className="dashboard-filter-label">From</label>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="input dashboard-filter-input" />
                <label className="dashboard-filter-label">To</label>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="input dashboard-filter-input" />
              </>
            )}
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <p className="loading-text">Loading…</p>
          ) : (
            <>
              {/* Summary cards with icons */}
              {quickStats && (
                <div className="dashboard-kpi-grid">
                  <div className="dashboard-kpi-card dashboard-kpi-card--accent">
                    <div className="dashboard-kpi-card__icon">
                      <IconUser className="dashboard-kpi-card__icon-svg" />
                    </div>
                    <div>
                      <div className="dashboard-kpi-card__value">{quickStats.total_users}</div>
                      <div className="dashboard-kpi-card__label">Total users</div>
                      {quickStats.total_users > 0 && (
                        <div className="dashboard-kpi-card__trend dashboard-kpi-card__trend--up">↑ Active</div>
                      )}
                    </div>
                  </div>
                  <div className="dashboard-kpi-card">
                    <div className="dashboard-kpi-card__icon">
                      <IconTeams className="dashboard-kpi-card__icon-svg" />
                    </div>
                    <div>
                      <div className="dashboard-kpi-card__value">{quickStats.total_teams}</div>
                      <div className="dashboard-kpi-card__label">Teams</div>
                    </div>
                  </div>
                  <div className={`dashboard-kpi-card ${quickStats.pending_approval === 0 ? '' : 'dashboard-kpi-card--warning'}`}>
                    <div className="dashboard-kpi-card__icon">
                      <IconBell className="dashboard-kpi-card__icon-svg" />
                    </div>
                    <div>
                      <div className="dashboard-kpi-card__value">{quickStats.pending_approval}</div>
                      <div className="dashboard-kpi-card__label">Pending approval</div>
                      {quickStats.pending_approval > 0 && (
                        <div className="dashboard-kpi-card__trend dashboard-kpi-card__trend--down">Needs attention</div>
                      )}
                    </div>
                  </div>
                  <div className="dashboard-kpi-card">
                    <div className="dashboard-kpi-card__icon">
                      <IconRequests className="dashboard-kpi-card__icon-svg" />
                    </div>
                    <div>
                      <div className="dashboard-kpi-card__value">{quickStats.requests_this_week}</div>
                      <div className="dashboard-kpi-card__label">Requests this week</div>
                    </div>
                  </div>
                  <div className={`dashboard-kpi-card ${quickStats.unverified_users === 0 ? '' : 'dashboard-kpi-card--warning'}`}>
                    <div className="dashboard-kpi-card__icon">
                      <IconShoppingBag className="dashboard-kpi-card__icon-svg" />
                    </div>
                    <div>
                      <div className="dashboard-kpi-card__value">{quickStats.unverified_users}</div>
                      <div className="dashboard-kpi-card__label">Unverified users</div>
                      {quickStats.unverified_users > 0 && (
                        <div className="dashboard-kpi-card__trend dashboard-kpi-card__trend--down">Review pending</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Charts row: Line chart + Donut */}
              <div className="dashboard-charts-row">
                <div className="card dashboard-line-card">
                  <h2 className="section-title">Recent movement</h2>
                  <DashboardLineChart data={trend} />
                </div>
                <div className="card dashboard-donut-card">
                  <h2 className="section-title">Status distribution</h2>
                  {dateFilter && (
                    <p style={{ margin: '-8px 0 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                      {dateFilter.from === dateFilter.to ? dateFilter.from : `${dateFilter.from} → ${dateFilter.to}`}: {dateFilter.total} request(s)
                    </p>
                  )}
                  <PieChart
                    title=""
                    segments={statusSegments}
                    emptyMessage="No requests in this period"
                  />
                </div>
              </div>

              {/* Period summary + SLA (when no chart data, show pills) */}
              {showPeriodSummary && dateFilter && !hasStatusData && (
                <div className="card" style={{ marginBottom: 24 }}>
                  <h2 className="section-title">
                    {period === 'custom' ? 'Requests in selected period' : `Requests (${period === 'today' ? 'today' : period === 'week' ? 'last 7 days' : 'this month'})`}
                  </h2>
                  <p style={{ margin: '0 0 12px', fontWeight: 600 }}>
                    {dateFilter.from === dateFilter.to ? dateFilter.from : `${dateFilter.from} → ${dateFilter.to}`}: {dateFilter.total} request(s)
                  </p>
                  <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No requests in this period.</p>
                  {quickStats?.sla && quickStats.sla.completed_count > 0 && (
                    <p style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
                      Avg time to complete: <strong style={{ color: 'var(--color-text)' }}>{quickStats.sla.avg_hours.toFixed(1)}h</strong> ({quickStats.sla.completed_count} completed)
                    </p>
                  )}
                </div>
              )}

              {showPeriodSummary && dateFilter && hasStatusData && quickStats?.sla && quickStats.sla.completed_count > 0 && (
                <div className="card" style={{ marginBottom: 24 }}>
                  <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                    Avg time to complete: <strong style={{ color: 'var(--color-text)' }}>{quickStats.sla.avg_hours.toFixed(1)}h</strong> ({quickStats.sla.completed_count} completed)
                  </p>
                </div>
              )}

              {/* Team comparison */}
              {quickStats?.team_comparison && quickStats.team_comparison.length > 0 && (
                <div className="card" style={{ marginBottom: 24 }}>
                  <h2 className="section-title">Team comparison</h2>
                  <div className="table-wrap">
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
                        {quickStats.team_comparison.map((t) => (
                          <tr key={t.team}>
                            <td><strong>{t.team}</strong></td>
                            <td>{t.total}</td>
                            <td>{t.completed}</td>
                            <td>{t.rejected}</td>
                            <td>{t.pending}</td>
                            <td>{t.rate.toFixed(0)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Recent requests */}
              <div className="card">
                <h2 className="section-title">Recent requests</h2>
                {recent.length === 0 ? (
                  <div className="empty-state">No PR requests yet.</div>
                ) : (
                  <>
                    <div className="table-wrap">
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
                                  {req.status === 'pending_approval' ? 'Pending approval' : req.status === 'in_progress' ? 'In progress' : req.status === 'completed' ? 'Completed' : req.status === 'rejected' ? 'Rejected' : req.status}
                                </span>
                              </td>
                              <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{new Date(req.created_at).toLocaleString()}</td>
                              <td>
                                {req.pr_url ? (
                                  <a href={req.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">Open PR</a>
                                ) : (
                                  <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p style={{ marginTop: 16 }}>
                      <Link href="/requests" className="btn btn-secondary">View all requests</Link>
                    </p>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </AdminLayout>
    </>
  );
}
