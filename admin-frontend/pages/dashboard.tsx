import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../components/AdminLayout';

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
              {/* Date-wise filter and ticket status breakdown */}
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
                        <input
                          type="date"
                          value={customFrom}
                          onChange={(e) => setCustomFrom(e.target.value)}
                          className="input"
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', marginBottom: 4, fontSize: 14, fontWeight: 500 }}>To</label>
                        <input
                          type="date"
                          value={customTo}
                          onChange={(e) => setCustomTo(e.target.value)}
                          className="input"
                        />
                      </div>
                      {!customFrom && (
                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Select from date</span>
                      )}
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
                        ? `${quickStats.date_filter.from}: ${quickStats.date_filter.total} request(s) came`
                        : `${quickStats.date_filter.from} to ${quickStats.date_filter.to}: ${quickStats.date_filter.total} request(s) came`}
                    </p>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {[
                        { key: 'completed', label: 'Completed', color: 'var(--color-success)' },
                        { key: 'rejected', label: 'Rejected', color: 'var(--color-danger)' },
                        { key: 'in_progress', label: 'In progress', color: 'var(--color-primary)' },
                        { key: 'pending_approval', label: 'Pending approval', color: 'var(--color-warning)' },
                        { key: 'draft', label: 'Draft', color: 'var(--color-text-muted)' },
                      ].map(({ key, label, color }) => {
                        const count = quickStats.date_filter!.by_status[key] ?? 0;
                        return (
                          <span
                            key={key}
                            style={{
                              padding: '6px 12px',
                              borderRadius: 6,
                              background: 'white',
                              border: '1px solid var(--color-border)',
                              fontSize: 14,
                              fontWeight: 600,
                              color: count > 0 ? color : 'var(--color-text-muted)',
                            }}
                          >
                            {count} {label}
                          </span>
                        );
                      })}
                      {Object.entries(quickStats.date_filter!.by_status || {}).filter(([k]) => !['completed', 'rejected', 'in_progress', 'pending_approval', 'draft'].includes(k)).map(([key, count]) => (
                        <span
                          key={key}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 6,
                            background: 'white',
                            border: '1px solid var(--color-border)',
                            fontSize: 14,
                            fontWeight: 600,
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {count} {key}
                        </span>
                      ))}
                    </div>
                    {quickStats.date_filter.total === 0 && (
                      <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>No requests in this period.</p>
                    )}
                  </div>
                )}
              </div>

              {quickStats && (
                <div className="stats-grid" style={{ marginBottom: 24 }}>
                  <div className="stat-card stat-card-primary">
                    <div className="stat-card-value">{quickStats.total_users}</div>
                    <div className="stat-card-label">Total users</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-card-value">{quickStats.total_teams}</div>
                    <div className="stat-card-label">Teams</div>
                  </div>
                  <div className="stat-card stat-card-warning">
                    <div className="stat-card-value">{quickStats.pending_approval}</div>
                    <div className="stat-card-label">Pending approval</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-card-value">{quickStats.requests_this_week}</div>
                    <div className="stat-card-label">Requests this week</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-card-value">{quickStats.unverified_users}</div>
                    <div className="stat-card-label">Unverified users</div>
                  </div>
                </div>
              )}
              {quickStats?.sla && quickStats.sla.completed_count > 0 && (
                <div className="card" style={{ marginBottom: 24 }}>
                  <h2 className="section-title">SLA metrics</h2>
                  <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                    Avg time to complete: <strong>{quickStats.sla.avg_hours.toFixed(1)}h</strong> ({quickStats.sla.completed_count} completed)
                  </p>
                </div>
              )}

              {quickStats?.trend && quickStats.trend.length > 0 && (
                <div className="card" style={{ marginBottom: 24 }}>
                  <h2 className="section-title">Request trend (last 14 days)</h2>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', minHeight: 80, flexWrap: 'wrap' }}>
                    {quickStats.trend.map((d) => (
                      <div
                        key={d.date}
                        title={`${d.date}: ${d.count}`}
                        style={{
                          flex: '1 1 24px',
                          minWidth: 20,
                          height: Math.max(4, (d.count / Math.max(1, ...(quickStats.trend ?? []).map((x) => x.count))) * 60),
                          background: 'var(--color-primary)',
                          borderRadius: 4,
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
                    <span>{quickStats.trend[0]?.date}</span>
                    <span>{quickStats.trend[quickStats.trend.length - 1]?.date}</span>
                  </div>
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

              {stats && (
                <div className="stats-grid">
                  <div className="stat-card stat-card-primary">
                    <div className="stat-card-value">{stats.total_requests}</div>
                    <div className="stat-card-label">Total PR requests</div>
                  </div>
                  {Object.entries(stats.by_cloud || {}).map(([cloud, count]) => (
                    <div key={cloud} className="stat-card">
                      <div className="stat-card-value">{count}</div>
                      <div className="stat-card-label">{cloud}</div>
                    </div>
                  ))}
                  {Object.entries(stats.by_status || {}).map(([status, count]) => (
                    <div key={status} className="stat-card">
                      <div className="stat-card-value">{count}</div>
                      <div className="stat-card-label">Status: {status}</div>
                    </div>
                  ))}
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
                                             req.status === 'rejected' ? 'var(--color-danger-bg)' : '#f1f5f9',
                                  color: req.status === 'pending_approval' ? 'var(--color-warning)' :
                                         req.status === 'in_progress' ? 'var(--color-primary)' :
                                         req.status === 'completed' ? 'var(--color-success)' :
                                         req.status === 'rejected' ? 'var(--color-danger)' : 'var(--color-text-muted)'
                                }}
                              >
                                {req.status === 'pending_approval' ? 'Pending approval' :
                                 req.status === 'in_progress' ? 'In progress' :
                                 req.status === 'completed' ? 'Completed' :
                                 req.status === 'rejected' ? 'Rejected' : req.status}
                              </span>
                            </td>
                            <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                              {new Date(req.created_at).toLocaleString()}
                            </td>
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
