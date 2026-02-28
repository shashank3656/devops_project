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
      const [dashboardRes, requestsRes] = await Promise.all([
        fetch(dashboardUrl, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/api/admin/requests?limit=10`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (dashboardRes.status === 401 || dashboardRes.status === 403 || requestsRes.status === 401 || requestsRes.status === 403) {
        router.replace('/login');
        return;
      }
      const [dashboardData, requestsData] = await Promise.all([
        dashboardRes.json().catch(() => ({})),
        requestsRes.json().catch(() => ({})),
      ]);
      if (dashboardData.total_users !== undefined) setQuickStats(dashboardData);
      if (requestsData.requests) setRecent(requestsData.requests);
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
