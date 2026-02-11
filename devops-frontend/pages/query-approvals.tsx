import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface QueryRequest {
  id: number;
  user_id: number;
  username: string;
  db_connection_name: string;
  query_text: string;
  status: string;
  submitted_at: string;
  approver_username?: string;
  approved_at?: string;
  rejected_at?: string;
  executed_at?: string;
  result_preview?: string;
  error_message?: string;
}

export default function QueryApprovalsPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [pending, setPending] = useState<QueryRequest[]>([]);
  const [audit, setAudit] = useState<QueryRequest[]>([]);
  const [totalPending, setTotalPending] = useState(0);
  const [totalAudit, setTotalAudit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'audit'>('pending');
  const [statusFilter, setStatusFilter] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchPending();
    fetchAudit();
  }, [token, router, apiUrl, statusFilter]);

  const fetchPending = () => {
    if (!token) return;
    fetch(`${apiUrl}/api/devops/query-pending?limit=50&offset=0`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403) router.replace('/login');
        return res.json();
      })
      .then((data) => {
        if (data.queries) setPending(data.queries);
        if (typeof data.total_count === 'number') setTotalPending(data.total_count);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const fetchAudit = () => {
    if (!token) return;
    const params = new URLSearchParams({ limit: '50', offset: '0' });
    if (statusFilter) params.set('status', statusFilter);
    fetch(`${apiUrl}/api/devops/query-audit?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.queries) setAudit(data.queries);
        if (typeof data.total_count === 'number') setTotalAudit(data.total_count);
      })
      .catch(() => {});
  };

  const handleApprove = async (id: number) => {
    if (!token) return;
    setActionLoading(id);
    try {
      const res = await fetch(`${apiUrl}/api/devops/query/${id}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      fetchPending();
      fetchAudit();
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: number) => {
    if (!token) return;
    setActionLoading(id);
    try {
      const res = await fetch(`${apiUrl}/api/devops/query/${id}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      fetchPending();
      fetchAudit();
    } finally {
      setActionLoading(null);
    }
  };

  const statusBadge = (s: string) => {
    const colors: Record<string, { bg: string; color: string }> = {
      pending_approval: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
      approved: { bg: 'var(--color-info-bg)', color: '#0ea5e9' },
      rejected: { bg: 'var(--color-danger-bg)', color: 'var(--color-danger)' },
      executed: { bg: 'var(--color-success-bg)', color: 'var(--color-success)' },
      failed: { bg: 'var(--color-danger-bg)', color: 'var(--color-danger)' },
    };
    const c = colors[s] || { bg: 'var(--color-surface-elevated)', color: 'var(--color-text-muted)' };
    return (
      <span style={{ padding: '4px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.bg, color: c.color }}>
        {s.replace(/_/g, ' ')}
      </span>
    );
  };

  return (
    <>
      <Head>
        <title>Query Approvals - InfraGate DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="container">
          <h1 className="page-title">Query Approvals</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
            Approve or reject user-submitted database queries. Approved queries execute automatically. Audit tab shows full history.
          </p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
            <button
              type="button"
              className={`btn ${tab === 'pending' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('pending')}
            >
              Pending ({totalPending})
            </button>
            <button
              type="button"
              className={`btn ${tab === 'audit' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTab('audit')}
            >
              Audit
            </button>
          </div>

          {tab === 'audit' && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ marginRight: 8 }}>Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="input"
                style={{ minWidth: 160 }}
              >
                <option value="">All</option>
                <option value="executed">Executed</option>
                <option value="failed">Failed</option>
                <option value="rejected">Rejected</option>
                <option value="pending_approval">Pending</option>
              </select>
            </div>
          )}

          <div className="card">
            {loading && tab === 'pending' ? (
              <p className="loading-text">Loading...</p>
            ) : tab === 'pending' ? (
              pending.length === 0 ? (
                <div className="empty-state">No pending queries.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>User</th>
                        <th>Database</th>
                        <th>Query</th>
                        <th>Submitted</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((q) => (
                        <tr key={q.id}>
                          <td>{q.id}</td>
                          <td>{q.username}</td>
                          <td>{q.db_connection_name}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: 12, maxWidth: 300 }}>
                            <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{q.query_text.slice(0, 200)}{q.query_text.length > 200 ? '...' : ''}</pre>
                          </td>
                          <td style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                            {new Date(q.submitted_at).toLocaleString()}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => handleApprove(q.id)}
                              disabled={actionLoading === q.id}
                            >
                              {actionLoading === q.id ? '...' : 'Approve'}
                            </button>
                            {' '}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleReject(q.id)}
                              disabled={actionLoading === q.id}
                            >
                              Reject
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : audit.length === 0 ? (
              <div className="empty-state">No audit entries.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>User</th>
                      <th>Approver</th>
                      <th>Database</th>
                      <th>Query</th>
                      <th>Status</th>
                      <th>Submitted</th>
                      <th>Executed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((q) => (
                      <tr key={q.id}>
                        <td>{q.id}</td>
                        <td>{q.username}</td>
                        <td>{q.approver_username || '—'}</td>
                        <td>{q.db_connection_name}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 11, maxWidth: 200 }}>
                          {q.query_text.slice(0, 80)}...
                        </td>
                        <td>{statusBadge(q.status)}</td>
                        <td style={{ fontSize: 13 }}>{new Date(q.submitted_at).toLocaleString()}</td>
                        <td style={{ fontSize: 13 }}>
                          {q.executed_at ? new Date(q.executed_at).toLocaleString() : q.rejected_at ? new Date(q.rejected_at).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </DevOpsLayout>
    </>
  );
}
