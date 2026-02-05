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
  const [recent, setRecent] = useState<PRRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchData();
  }, [token, router]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, requestsRes] = await Promise.all([
        fetch(`${apiUrl}/api/admin/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${apiUrl}/api/admin/requests?limit=10`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (statsRes.status === 401 || statsRes.status === 403 || requestsRes.status === 401 || requestsRes.status === 403) {
        router.replace('/login');
        return;
      }
      const statsData = await statsRes.json().catch(() => ({}));
      const requestsData = await requestsRes.json().catch(() => ({}));
      if (statsData.stats) setStats(statsData.stats);
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
              {stats && (
                <div className="stats-grid">
                  <div className="stat-card">
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
                              <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>
                                {req.status}
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
