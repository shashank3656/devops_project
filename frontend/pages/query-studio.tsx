import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AppLayout from '../components/AppLayout';
import { useToast } from '../context/ToastContext';

interface DBConnection {
  id: number;
  name: string;
  db_type: string;
  team_id?: number;
}

interface QueryRequest {
  id: number;
  db_connection_name: string;
  query_text: string;
  status: string;
  result_preview?: string;
  error_message?: string;
  submitted_at: string;
  approved_at?: string;
  rejected_at?: string;
  executed_at?: string;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export default function QueryStudio() {
  const router = useRouter();
  const { toast } = useToast();
  const [connections, setConnections] = useState<DBConnection[]>([]);
  const [selectedConn, setSelectedConn] = useState<number | ''>('');
  const [queryText, setQueryText] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [myQueries, setMyQueries] = useState<QueryRequest[]>([]);
  const [totalQueries, setTotalQueries] = useState(0);
  const [activeTab, setActiveTab] = useState<'run' | 'history'>('run');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      router.push('/login');
      return;
    }
    fetchConnections();
    fetchMyQueries();
  }, [router]);

  const fetchConnections = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/query/connections`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.connections) setConnections(data.connections);
      if (data.connections?.length > 0 && !selectedConn) {
        setSelectedConn(data.connections[0].id);
      }
    } catch (_) {
      toast('Failed to load databases', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchMyQueries = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${apiUrl}/api/query?limit=50&offset=0`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.queries) setMyQueries(data.queries);
      if (typeof data.total_count === 'number') setTotalQueries(data.total_count);
    } catch (_) {}
  };

  const handleSubmit = async () => {
    if (!selectedConn || !queryText.trim()) {
      toast('Select a database and enter a query', 'error');
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;
    setSubmitLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ db_connection_id: selectedConn, query_text: queryText.trim() }),
      });
      const data = await res.json();
      if (data.error) {
        toast(data.error, 'error');
        return;
      }
      toast('Query submitted for DevOps approval', 'success');
      setQueryText('');
      fetchMyQueries();
      setActiveTab('history');
    } catch (_) {
      toast('Failed to submit query', 'error');
    } finally {
      setSubmitLoading(false);
    }
  };

  const dbTypeLabel = (t: string) => {
    const m: Record<string, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', mongodb: 'MongoDB' };
    return m[t] || t;
  };

  const statusBadge = (s: string) => {
    const colors: Record<string, { bg: string; color: string }> = {
      pending_approval: { bg: 'var(--warning-bg)', color: 'var(--warning-color)' },
      approved: { bg: 'var(--info-bg)', color: 'var(--info-color)' },
      rejected: { bg: 'var(--error-bg)', color: 'var(--error-color)' },
      executed: { bg: 'var(--success-bg)', color: 'var(--success-color)' },
      failed: { bg: 'var(--error-bg)', color: 'var(--error-color)' },
    };
    const c = colors[s] || { bg: 'var(--bg-button-secondary)', color: 'var(--text-secondary)' };
    return (
      <span style={{ padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.bg, color: c.color }}>
        {s.replace(/_/g, ' ')}
      </span>
    );
  };

  return (
    <>
      <Head>
        <title>Query Studio - InfraGate</title>
      </Head>
      <AppLayout>
        <div className="container" style={{ maxWidth: 1100 }}>
          <h1 className="page-title" style={{ marginBottom: 24 }}>Query Studio</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
            Run queries against approved databases. All queries require DevOps manager approval before execution.
          </p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <button
              type="button"
              className={`btn ${activeTab === 'run' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('run')}
            >
              Run Query
            </button>
            <button
              type="button"
              className={`btn ${activeTab === 'history' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('history')}
            >
              My Queries ({totalQueries})
            </button>
          </div>

          {activeTab === 'run' && (
            <div className="card" style={{ padding: 24 }}>
              {loading ? (
                <p className="loading-text">Loading databases...</p>
              ) : connections.length === 0 ? (
                <div className="empty-state">
                  No databases configured. Contact your administrator to add database connections.
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Database</label>
                    <select
                      value={selectedConn}
                      onChange={(e) => setSelectedConn(e.target.value ? Number(e.target.value) : '')}
                      className="input"
                      style={{ minWidth: 280 }}
                    >
                      {connections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({dbTypeLabel(c.db_type)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Query</label>
                    <textarea
                      value={queryText}
                      onChange={(e) => setQueryText(e.target.value)}
                      placeholder="SELECT * FROM users LIMIT 10"
                      className="input"
                      rows={8}
                      style={{ fontFamily: 'monospace', fontSize: 13, width: '100%' }}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSubmit}
                    disabled={submitLoading || !queryText.trim()}
                  >
                    {submitLoading ? 'Submitting...' : 'Submit for Approval'}
                  </button>
                </>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="card">
              {myQueries.length === 0 ? (
                <div className="empty-state">No queries yet. Submit a query to see it here.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Database</th>
                        <th>Query</th>
                        <th>Status</th>
                        <th>Submitted</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myQueries.map((q) => (
                        <tr key={q.id}>
                          <td style={{ fontSize: 13 }}>{q.id}</td>
                          <td style={{ fontSize: 13 }}>{q.db_connection_name}</td>
                          <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={q.query_text}>
                            {q.query_text.slice(0, 60)}...
                          </td>
                          <td>{statusBadge(q.status)}</td>
                          <td style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                            {new Date(q.submitted_at).toLocaleString()}
                          </td>
                          <td style={{ fontSize: 12, maxWidth: 180 }}>
                            {q.status === 'executed' && q.result_preview && (
                              <details>
                                <summary>View</summary>
                                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, maxHeight: 120, overflow: 'auto' }}>
                                  {q.result_preview.slice(0, 500)}
                                  {q.result_preview.length > 500 && '...'}
                                </pre>
                              </details>
                            )}
                            {q.status === 'failed' && q.error_message && (
                              <span style={{ color: 'var(--error-color)' }} title={q.error_message}>
                                {q.error_message.slice(0, 80)}...
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </AppLayout>
    </>
  );
}
