import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AdminLayout from '../components/AdminLayout';

interface PRRequest {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  pr_url: string;
  branch: string;
  file_path: string;
  status: string;
  created_at: string;
}

export default function AdminRequests() {
  const router = useRouter();
  const [requests, setRequests] = useState<PRRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [team, setTeam] = useState('');
  const [env, setEnv] = useState('');
  const [cloud, setCloud] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchRequests({ offset });
  }, [token, router, offset]);

  const fetchRequests = (overrides?: { team?: string; env?: string; cloud?: string; offset?: number }) => {
    const t = overrides?.team !== undefined ? overrides.team : team;
    const e = overrides?.env !== undefined ? overrides.env : env;
    const c = overrides?.cloud !== undefined ? overrides.cloud : cloud;
    const o = overrides?.offset !== undefined ? overrides.offset : offset;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (t) params.set('team', t);
    if (e) params.set('env', e);
    if (c) params.set('cloud', c);
    params.set('limit', String(limit));
    params.set('offset', String(o));
    fetch(`${apiUrl}/api/admin/requests?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403) router.replace('/login');
        return res.json();
      })
      .then((data) => {
        if (data.requests) setRequests(data.requests);
        if (typeof data.total_count === 'number') setTotal(data.total_count);
        if (data.error) setError(data.error);
      })
      .catch(() => setError('Failed to load requests'))
      .finally(() => setLoading(false));
  };

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    fetchRequests({ offset: 0 });
  };

  const totalPages = Math.ceil(total / limit) || 1;
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <>
      <Head>
        <title>PR Requests - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container" style={{ maxWidth: 1200 }}>
          <h1 className="page-title" style={{ marginBottom: 24 }}>PR Requests</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24 }}>
            All infrastructure PR requests from the portal. Use filters to narrow by team, env, or cloud.
          </p>

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleFilter} className="filters-bar">
            <input
              type="text"
              className="input"
              placeholder="Team"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
            />
            <input
              type="text"
              className="input"
              placeholder="Env"
              value={env}
              onChange={(e) => setEnv(e.target.value)}
            />
            <input
              type="text"
              className="input"
              placeholder="Cloud"
              value={cloud}
              onChange={(e) => setCloud(e.target.value)}
            />
            <button type="submit" className="btn btn-primary">
              Apply filters
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setTeam('');
                setEnv('');
                setCloud('');
                setOffset(0);
                fetchRequests({ team: '', env: '', cloud: '', offset: 0 });
              }}
            >
              Clear
            </button>
          </form>

          <div className="card">
            {loading ? (
              <p className="loading-text">Loading…</p>
            ) : requests.length === 0 ? (
              <div className="empty-state">
                No PR requests match the filters.
              </div>
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
                      {requests.map((req) => (
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
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
                    Page {currentPage} of {totalPages} ({total} total)
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={offset === 0}
                    onClick={() => setOffset((o) => Math.max(0, o - limit))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={offset + limit >= total}
                    onClick={() => setOffset((o) => o + limit)}
                  >
                    Next
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </AdminLayout>
    </>
  );
}
