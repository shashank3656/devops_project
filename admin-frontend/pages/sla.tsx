import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AdminLayout from '../components/AdminLayout';

interface SLAData {
  sla?: { avg_hours: number; completed_count: number };
  date_filter?: { from: string; to: string; total: number; by_status: Record<string, number> };
  team_comparison?: Array<{ team: string; total: number; completed: number; rejected: number; pending: number; rate: number }>;
  trend?: Array<{ date: string; count: number }>;
  at_risk_count?: number;
}

export default function SLADashboard() {
  const router = useRouter();
  const [data, setData] = useState<SLAData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('week');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ period });
    fetch(`${apiUrl}/api/admin/dashboard-stats?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403) router.replace('/login');
        return res.json();
      })
      .then((d) => {
        setData(d);
        if (d.error) setError(d.error);
      })
      .catch(() => setError('Failed to load SLA data'))
      .finally(() => setLoading(false));
  }, [token, router, period]);

  const sla = data?.sla;
  const df = data?.date_filter;
  const teams = data?.team_comparison || [];
  const trend = data?.trend || [];

  return (
    <AdminLayout>
      <Head>
        <title>SLA Dashboard - Admin</title>
      </Head>
      <div className="sla-dashboard">
        <div className="sla-dashboard__header">
          <h2>SLA Dashboard</h2>
          <div className="sla-dashboard__period">
            {(['today', 'week', 'month'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`btn ${period === p ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPeriod(p)}
              >
                {p === 'today' ? 'Today' : p === 'week' ? 'Last 7 days' : 'This month'}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="sla-dashboard__loading">Loading…</p>}
        {error && <p className="sla-dashboard__error">{error}</p>}

        {!loading && !error && (
          <>
            <div className="sla-dashboard__cards">
              <div className="sla-card">
                <div className="sla-card__label">Avg. completion time</div>
                <div className="sla-card__value">
                  {sla?.avg_hours != null ? `${sla.avg_hours.toFixed(1)}h` : '—'}
                </div>
              </div>
              <div className="sla-card">
                <div className="sla-card__label">Completed (period)</div>
                <div className="sla-card__value">{sla?.completed_count ?? 0}</div>
              </div>
              <div className="sla-card">
                <div className="sla-card__label">Total requests</div>
                <div className="sla-card__value">{df?.total ?? 0}</div>
              </div>
              <div className="sla-card">
                <div className="sla-card__label">At risk</div>
                <div className="sla-card__value">{data?.at_risk_count ?? 0}</div>
              </div>
            </div>

            {teams.length > 0 && (
              <div className="sla-dashboard__section">
                <h3>By team</h3>
                <div className="sla-table-wrap">
                  <table className="sla-table">
                    <thead>
                      <tr>
                        <th>Team</th>
                        <th>Total</th>
                        <th>Completed</th>
                        <th>Rejected</th>
                        <th>Pending</th>
                        <th>Completion rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teams.map((t) => (
                        <tr key={t.team}>
                          <td>{t.team}</td>
                          <td>{t.total}</td>
                          <td>{t.completed}</td>
                          <td>{t.rejected}</td>
                          <td>{t.pending}</td>
                          <td>{t.rate != null ? `${(t.rate * 100).toFixed(0)}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {df?.by_status && Object.keys(df.by_status).length > 0 && (
              <div className="sla-dashboard__section">
                <h3>By status</h3>
                <ul className="sla-status-list">
                  {Object.entries(df.by_status).map(([status, count]) => (
                    <li key={status}>
                      <span className="sla-status-list__status">{status}</span>
                      <span className="sla-status-list__count">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {trend.length > 0 && (
              <div className="sla-dashboard__section">
                <h3>Trend (last 14 days)</h3>
                <div className="sla-trend">
                  {trend.map((t) => (
                    <div key={t.date} className="sla-trend__bar-wrap">
                      <div
                        className="sla-trend__bar"
                        style={{ height: `${Math.min(100, (t.count / Math.max(...trend.map((x) => x.count), 1)) * 100)}%` }}
                      />
                      <span className="sla-trend__label">{t.date.slice(5)}</span>
                      <span className="sla-trend__count">{t.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <style jsx>{`
        .sla-dashboard { padding: 1rem; }
        .sla-dashboard__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 0.75rem; }
        .sla-dashboard__period { display: flex; gap: 0.5rem; }
        .sla-dashboard__loading, .sla-dashboard__error { padding: 1rem; }
        .sla-dashboard__error { color: var(--color-error, #dc2626); }
        .sla-dashboard__cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .sla-card { background: var(--card-bg, #fff); border: 1px solid var(--border, #e5e7eb); border-radius: 8px; padding: 1rem; }
        .sla-card__label { font-size: 0.875rem; color: var(--muted, #6b7280); margin-bottom: 0.25rem; }
        .sla-card__value { font-size: 1.5rem; font-weight: 600; }
        .sla-dashboard__section { margin-bottom: 2rem; }
        .sla-dashboard__section h3 { margin-bottom: 0.75rem; font-size: 1rem; }
        .sla-table-wrap { overflow-x: auto; }
        .sla-table { width: 100%; border-collapse: collapse; }
        .sla-table th, .sla-table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border, #e5e7eb); }
        .sla-status-list { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
        .sla-status-list li { display: flex; gap: 0.5rem; padding: 0.25rem 0.5rem; background: var(--card-bg, #f9fafb); border-radius: 4px; }
        .sla-trend { display: flex; align-items: flex-end; gap: 4px; height: 120px; }
        .sla-trend__bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; min-width: 0; }
        .sla-trend__bar { width: 100%; min-height: 4px; background: var(--primary, #0d9488); border-radius: 2px 2px 0 0; }
        .sla-trend__label { font-size: 0.65rem; color: var(--muted, #6b7280); margin-top: 4px; }
        .sla-trend__count { font-size: 0.75rem; font-weight: 500; }
      `}</style>
    </AdminLayout>
  );
}
