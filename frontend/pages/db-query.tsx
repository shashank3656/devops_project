import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import AppLayout from '../components/AppLayout';

interface Connection {
  id: number;
  name: string;
  db_type: string;
  project: string;
}

interface QueryRequest {
  id: number;
  connection_name: string;
  project: string;
  query: string;
  status: string;
  requester_name: string;
  approved_by_name?: string;
  approved_at?: string;
  executed_at?: string;
  result_rows?: number;
  created_at: string;
}

export default function UserDbQueryPage() {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState('');
  const [connectionId, setConnectionId] = useState<number | ''>('');
  const [query, setQuery] = useState('SELECT * FROM users LIMIT 10');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [requests, setRequests] = useState<QueryRequest[]>([]);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const fetchConnections = () => {
    if (!token) return;
    const params = projectFilter ? `?project=${encodeURIComponent(projectFilter)}` : '';
    fetch(`${apiUrl}/api/me/db-connections${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed'))))
      .then((data) => {
        setConnections(data.connections || []);
        setProjects(data.projects || []);
        if (data.connections?.length > 0 && !connectionId) setConnectionId(data.connections[0].id);
      })
      .catch(() => setConnections([]));
  };

  const fetchRequests = () => {
    if (!token) return;
    fetch(`${apiUrl}/api/me/db-query-requests`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed'))))
      .then((data) => setRequests(data.requests || []))
      .catch(() => setRequests([]));
  };

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchConnections();
    fetchRequests();
  }, [token, router, apiUrl, projectFilter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !query.trim()) return;
    const connId = connectionId || connections[0]?.id;
    if (!connId) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`${apiUrl}/api/me/db-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ connection_id: connId, query: query.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccess('Query submitted. A DevOps manager will approve it.');
        fetchRequests();
      } else {
        setError(data.error || 'Failed to submit');
      }
    } catch (_) {
      setError('Failed to submit');
    } finally {
      setLoading(false);
    }
  };

  const statusLabel = (s: string) => {
    const m: Record<string, string> = {
      pending_approval: 'Pending approval',
      approved: 'Approved',
      rejected: 'Rejected',
      executed: 'Executed',
    };
    return m[s] || s;
  };

  return (
    <>
      <Head>
        <title>DB Query - InfraGate</title>
      </Head>
      <AppLayout>
        <div className="container" style={{ maxWidth: 1000 }}>
          <h1 className="page-title" style={{ marginBottom: 24 }}>Database Query</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
            Submit read-only queries for DevOps manager approval. Queries are not executed until approved.
          </p>

          <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', marginBottom: 16 }}>
              {projects.length > 0 && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Project</label>
                  <select
                    value={projectFilter}
                    onChange={(e) => { setProjectFilter(e.target.value); setConnectionId(''); }}
                    className="input"
                    style={{ minWidth: 140 }}
                  >
                    <option value="">All</option>
                    {projects.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Connection</label>
                <select
                  value={connectionId}
                  onChange={(e) => setConnectionId(e.target.value ? Number(e.target.value) : '')}
                  className="input"
                  style={{ minWidth: 220 }}
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.db_type})</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Submitting…' : 'Submit for approval'}
              </button>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Query (SELECT only)</label>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="input"
                rows={6}
                placeholder="SELECT * FROM users LIMIT 10"
                style={{ fontFamily: 'monospace', fontSize: 13, width: '100%', resize: 'vertical' }}
                spellCheck={false}
              />
            </div>
          </form>

          {error && <div className="alert alert-error">{error}</div>}
          {success && <div className="alert" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>{success}</div>}

          <div className="card">
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>My query requests</h2>
            {requests.length === 0 ? (
              <div className="empty-state">No queries submitted yet.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Connection</th>
                      <th>Query</th>
                      <th>Status</th>
                      <th>Approved by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontSize: 13 }}>{new Date(r.created_at).toLocaleString()}</td>
                        <td>{r.connection_name}</td>
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.query}>{r.query}</td>
                        <td>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            background: r.status === 'rejected' ? 'var(--color-danger-bg)' :
                              r.status === 'executed' ? 'var(--color-success-bg)' :
                              r.status === 'pending_approval' ? 'var(--color-warning-bg)' : 'var(--color-bg)',
                            color: r.status === 'rejected' ? 'var(--color-danger)' :
                              r.status === 'executed' ? 'var(--color-success)' : 'var(--color-text)',
                          }}>
                            {statusLabel(r.status)}
                          </span>
                        </td>
                        <td>{r.approved_by_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </AppLayout>
    </>
  );
}
