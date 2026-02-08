import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../components/AdminLayout';
import PieChart, { PieChartSegment } from '../components/PieChart';

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

const TREND_MAX_BAR_HEIGHT = 140;

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [quickStats, setQuickStats] = useState<DashboardStats | null>(null);
  const [recent, setRecent] = useState<PRRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'custom'>('today');
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
  }, [token, router, dateFilter, customFrom, customTo]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    const dashboardParams = new URLSearchParams();
    if (dateFilter === 'today' || dateFilter === 'week' || dateFilter === 'month') {
      dashboardParams.set('period', dateFilter);
    } else if (dateFilter === 'custom' && customFrom) {
      dashboardParams.set('from', customFrom);
      dashboardParams.set('to', customTo || customFrom);
    }
    const dashboardUrl = dashboardParams.toString() ? `${apiUrl}/api/admin/dashboard-stats?${dashboardParams}` : `${apiUrl}/api/admin/dashboard-stats`;
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
      const statsData = await statsRes.json().catch(() => ({}));
      const dashboardData = await dashboardRes.json().catch(() => ({}));
      const requestsData = await requestsRes.json().catch(() => ({}));
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

  const trend = quickStats?.trend ?? [];
  const trendMax = Math.max(1, ...trend.map((d) => d.count));

  const statusColors: Record<string, string> = {
    completed: 'var(--color-success)',
    rejected: 'var(--color-danger)',
    in_progress: 'var(--color-primary)',
    pending_approval: 'var(--color-warning)',
    pending_devops_approval: '#0ea5e9',
    draft: 'var(--color-text-muted)',
  };
  const cloudColors: Record<string, string> = {
    aws: '#ff9900',
    gcp: '#4285f4',
    azure: '#0078d4',
  };
  const pieByStatus = useMemo((): PieChartSegment[] => {
    if (!stats?.by_status) return [];
    return Object.entries(stats.by_status).map(([status, value]) => ({
      label: status.replace(/_/g, ' '),
      value,
      color: statusColors[status] || 'var(--color-text-muted)',
    }));
  }, [stats?.by_status]);
  const pieByCloud = useMemo((): PieChartSegment[] => {
    if (!stats?.by_cloud) return [];
    return Object.entries(stats.by_cloud).map(([cloud, value]) => ({
      label: cloud,
      value,
      color: cloudColors[cloud.toLowerCase()] || 'var(--color-primary)',
    }));
  }, [stats?.by_cloud]);

  return (
    <>
      <Head>
        <title>Dashboard - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container" style={{ maxWidth: 1200 }}>
          <div className="page-header">
            <h1 className="page-title">Dashboard</h1>
            <Link href="/requests" className="btn btn-primary">
              View all requests
            </Link>
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
              {/* Top row: 5 KPI cards – graphical, user-visible */}
              {quickStats && (
                <div className="dashboard-kpi-grid">
                  <div className="dashboard-kpi-card dashboard-kpi-card--accent">
                    <div className="dashboard-kpi-card__value">{quickStats.total_users}</div>
                    <div className="dashboard-kpi-card__label">Total users</div>
                  </div>
                  <div className="dashboard-kpi-card">
                    <div className="dashboard-kpi-card__value">{quickStats.total_teams}</div>
                    <div className="dashboard-kpi-card__label">Teams</div>
                  </div>
                  <div className={`dashboard-kpi-card ${quickStats.pending_approval === 0 ? 'dashboard-kpi-card--warning' : ''}`}>
                    <div className="dashboard-kpi-card__value">{quickStats.pending_approval}</div>
                    <div className="dashboard-kpi-card__label">Pending approval</div>
                  </div>
                  <div className="dashboard-kpi-card">
                    <div className="dashboard-kpi-card__value">{quickStats.requests_this_week}</div>
                    <div className="dashboard-kpi-card__label">Requests this week</div>
                  </div>
                  <div className={`dashboard-kpi-card ${quickStats.unverified_users === 0 ? 'dashboard-kpi-card--warning' : ''}`}>
                    <div className="dashboard-kpi-card__value">{quickStats.unverified_users}</div>
                    <div className="dashboard-kpi-card__label">Unverified users</div>
                  </div>
                </div>
              )}

              {/* Request trend – last 14 days (bar chart) */}
              <div className="dashboard-trend-card">
                <h2 className="section-title">Request trend (last 14 days)</h2>
                {trend.length === 0 ? (
                  <div className="dashboard-trend-chart" style={{ alignItems: 'center', justifyContent: 'center' }}>
                    <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>No request data for the last 14 days.</p>
                  </div>
                ) : (
                  <>
                    <div className="dashboard-trend-chart">
                      {trend.map((d) => (
                        <div key={d.date} className="dashboard-trend-bar-wrap" title={`${d.date}: ${d.count} request(s)`}>
                          <div
                            className="dashboard-trend-bar"
                            style={{
                              height: `${Math.max(4, (d.count / trendMax) * TREND_MAX_BAR_HEIGHT)}px`,
                            }}
                          />
                          <span className="dashboard-trend-bar__label">{d.date.slice(5)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="dashboard-trend-axis">
                      <span>{trend[0]?.date ?? '—'}</span>
                      <span>{trend[trend.length - 1]?.date ?? '—'}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Second row: Total PR requests + cloud + status */}
              {stats && (
                <div className="dashboard-stats-row">
                  <div className="dashboard-kpi-card dashboard-kpi-card--accent">
                    <div className="dashboard-kpi-card__value">{stats.total_requests}</div>
                    <div className="dashboard-kpi-card__label">Total PR requests</div>
                  </div>
                  {Object.entries(stats.by_cloud || {}).map(([cloud, count]) => (
                    <div key={cloud} className="dashboard-kpi-card">
                      <div className="dashboard-kpi-card__value">{count}</div>
                      <div className="dashboard-kpi-card__label">{cloud}</div>
                    </div>
                  ))}
                  {Object.entries(stats.by_status || {}).map(([status, count]) => (
                    <div key={status} className="dashboard-kpi-card">
                      <div className="dashboard-kpi-card__value">{count}</div>
                      <div className="dashboard-kpi-card__label">Status: {status.replace(/_/g, ' ')}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pie charts – requests by status & by cloud */}
              {stats && (pieByStatus.length > 0 || pieByCloud.length > 0) && (
                <div className="dashboard-pie-row">
                  <PieChart
                    title="Requests by status"
                    segments={pieByStatus}
                    emptyMessage="No request status data"
                  />
                  <PieChart
                    title="Requests by cloud"
                    segments={pieByCloud}
                    emptyMessage="No cloud data"
                  />
                </div>
              )}

              {/* Cloud & status distribution – visual chips */}
              {stats && (Object.keys(stats.by_cloud || {}).length > 0 || Object.keys(stats.by_status || {}).length > 0) && (
                <div className="card" style={{ marginBottom: 24 }}>
                  <h2 className="section-title">Distribution</h2>
                  {Object.keys(stats.by_cloud || {}).length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>By cloud</span>
                      <div className="dashboard-distribution">
                        {Object.entries(stats.by_cloud || {}).map(([cloud, count]) => (
                          <div key={cloud} className="dashboard-distribution__item">
                            <span className="dashboard-distribution__value">{count}</span>
                            <span className="dashboard-distribution__label">{cloud}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {Object.keys(stats.by_status || {}).length > 0 && (
                    <div>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>By status</span>
                      <div className="dashboard-distribution">
                        {Object.entries(stats.by_status || {}).map(([status, count]) => (
                          <div key={status} className="dashboard-distribution__item">
                            <span className="dashboard-distribution__value">{count}</span>
                            <span className="dashboard-distribution__label">{status.replace(/_/g, ' ')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Date filter & breakdown */}
              <div className="card" style={{ marginBottom: 24 }}>
                <h2 className="section-title">Requests by date</h2>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>Filter by</label>
                    <select
                      value={dateFilter}
                      onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
                      className="input"
                      style={{ minWidth: 140 }}
                    >
                      <option value="today">Today</option>
                      <option value="week">Last 7 days</option>
                      <option value="month">This month</option>
                      <option value="custom">Custom range</option>
                    </select>
                  </div>
                  {dateFilter === 'custom' && (
                    <>
                      <div>
                        <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>From</label>
                        <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="input" />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>To</label>
                        <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="input" />
                      </div>
                      {!customFrom && <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Select from date</span>}
                    </>
                  )}
                </div>
                {dateFilter === 'custom' && !customFrom && (
                  <p style={{ padding: 16, color: 'var(--color-text-muted)', margin: 0 }}>Select From and To dates to see the breakdown.</p>
                )}
                {quickStats?.date_filter && (dateFilter !== 'custom' || customFrom) && (
                  <div style={{ padding: 16, background: 'var(--color-bg)', borderRadius: 8 }}>
                    <p style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>
                      {quickStats.date_filter.from === quickStats.date_filter.to
                        ? `${quickStats.date_filter.from}: ${quickStats.date_filter.total} request(s)`
                        : `${quickStats.date_filter.from} to ${quickStats.date_filter.to}: ${quickStats.date_filter.total} request(s)`}
                    </p>
                    <div className="dashboard-distribution">
                      {[
                        { key: 'completed', label: 'Completed', color: 'var(--color-success)' },
                        { key: 'rejected', label: 'Rejected', color: 'var(--color-danger)' },
                        { key: 'in_progress', label: 'In progress', color: 'var(--color-primary)' },
                        { key: 'pending_approval', label: 'Pending approval', color: 'var(--color-warning)' },
                        { key: 'draft', label: 'Draft', color: 'var(--color-text-muted)' },
                      ].map(({ key, label, color }) => {
                        const count = quickStats.date_filter!.by_status[key] ?? 0;
                        return (
                          <div key={key} className="dashboard-distribution__item" style={{ borderLeft: `3px solid ${count > 0 ? color : 'var(--color-border)' }` }}>
                            <span className="dashboard-distribution__value" style={count > 0 ? { color } : {}}>{count}</span>
                            <span className="dashboard-distribution__label">{label}</span>
                          </div>
                        );
                      })}
                      {Object.entries(quickStats.date_filter!.by_status || {}).filter(([k]) => !['completed', 'rejected', 'in_progress', 'pending_approval', 'draft'].includes(k)).map(([key, count]) => (
                        <div key={key} className="dashboard-distribution__item">
                          <span className="dashboard-distribution__value">{count}</span>
                          <span className="dashboard-distribution__label">{key.replace(/_/g, ' ')}</span>
                        </div>
                      ))}
                    </div>
                    {quickStats.date_filter.total === 0 && (
                      <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>No requests in this period.</p>
                    )}
                  </div>
                )}
              </div>

              {quickStats?.sla && quickStats.sla.completed_count > 0 && (
                <div className="card" style={{ marginBottom: 24 }}>
                  <h2 className="section-title">SLA metrics</h2>
                  <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                    Avg time to complete: <strong style={{ color: 'var(--color-text)' }}>{quickStats.sla.avg_hours.toFixed(1)}h</strong> ({quickStats.sla.completed_count} completed)
                  </p>
                </div>
              )}

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

              <div className="card">
                <h2 className="section-title">Recent PR requests</h2>
                {recent.length === 0 ? (
                  <div className="empty-state">
                    No PR requests yet. Requests from the portal will appear here.
                  </div>
                ) : (
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
                              <span
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 6,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  background: req.status === 'pending_approval' ? 'var(--color-warning-bg)' :
                                    req.status === 'in_progress' ? 'var(--color-primary-light)' :
                                    req.status === 'completed' ? 'var(--color-success-bg)' :
                                    req.status === 'rejected' ? 'var(--color-danger-bg)' : 'var(--color-bg)',
                                  color: req.status === 'pending_approval' ? 'var(--color-warning)' :
                                    req.status === 'in_progress' ? 'var(--color-primary)' :
                                    req.status === 'completed' ? 'var(--color-success)' :
                                    req.status === 'rejected' ? 'var(--color-danger)' : 'var(--color-text-muted)',
                                }}
                              >
                                {req.status === 'pending_approval' ? 'Pending approval' :
                                  req.status === 'in_progress' ? 'In progress' :
                                  req.status === 'completed' ? 'Completed' :
                                  req.status === 'rejected' ? 'Rejected' : req.status}
                              </span>
                            </td>
                            <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{new Date(req.created_at).toLocaleString()}</td>
                            <td>
                              {req.pr_url ? (
                                <a href={req.pr_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }}>
                                  Open PR
                                </a>
                              ) : (
                                <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {recent.length > 0 && (
                  <p style={{ marginTop: 16 }}>
                    <Link href="/requests" className="btn btn-secondary">
                      View all requests
                    </Link>
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </AdminLayout>
    </>
  );
}
