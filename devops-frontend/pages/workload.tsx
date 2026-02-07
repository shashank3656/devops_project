import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

const DEVOPS_TOKEN_KEY = 'devops_token';

interface Request {
  id: number;
  team: string;
  env: string;
  cloud: string;
  service: string;
  status: string;
  priority: string;
  pr_url: string;
  application_id: string;
  updated_at: string;
  created_at?: string;
}

interface WorkloadItem {
  request: Request;
  assignee_id: number;
  assignee_username: string;
}

interface DevopsUser {
  id: number;
  username: string;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'pending_approval', label: 'Pending approval' },
];

export default function DevOpsWorkload() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [pendingApprovals, setPendingApprovals] = useState<Request[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [workload, setWorkload] = useState<WorkloadItem[]>([]);
  const [devopsUsers, setDevopsUsers] = useState<DevopsUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState<number | null>(null);
  const [filterUserId, setFilterUserId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  // Per-user ticket counts and status breakdown (from workload)
  const userStats = useMemo(() => {
    const byUser: Record<number, { username: string; total: number; byStatus: Record<string, number> }> = {};
    workload.forEach((item) => {
      const id = item.assignee_id;
      const name = item.assignee_username;
      if (!byUser[id]) {
        byUser[id] = { username: name, total: 0, byStatus: {} };
      }
      byUser[id].total += 1;
      const s = item.request.status || 'unknown';
      byUser[id].byStatus[s] = (byUser[id].byStatus[s] || 0) + 1;
    });
    return Object.entries(byUser)
      .map(([id, data]) => ({ userId: Number(id), ...data }))
      .sort((a, b) => b.total - a.total);
  }, [workload]);

  const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const fetchPending = useCallback(() => {
    if (!token) return;
    setPendingLoading(true);
    fetch(`${apiUrl}/api/devops/pending-approvals`, { headers })
      .then((res) => {
        if (res.status === 401 || res.status === 403) router.replace('/login');
        return res.json();
      })
      .then((data) => {
        if (data?.requests) setPendingApprovals(data.requests);
      })
      .catch(() => {})
      .finally(() => setPendingLoading(false));
  }, [token, apiUrl, router]);

  const fetchWorkload = useCallback(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${apiUrl}/api/devops/workload`, { headers })
      .then((res) => {
        if (res.status === 401 || res.status === 403) router.replace('/login');
        return res.json();
      })
      .then((data) => {
        if (data?.workload) setWorkload(data.workload);
        else if (data?.error) setError(data.error);
      })
      .catch(() => setError('Failed to load workload'))
      .finally(() => setLoading(false));
  }, [token, apiUrl, router]);

  const fetchDevopsUsers = useCallback(() => {
    if (!token) return;
    fetch(`${apiUrl}/api/devops/users`, { headers })
      .then((res) => {
        if (res.status === 401 || res.status === 403) return null;
        return res.json();
      })
      .then((data) => {
        if (data?.users) setDevopsUsers(data.users);
      })
      .catch(() => {});
  }, [token, apiUrl]);

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchPending();
    fetchWorkload();
    fetchDevopsUsers();
  }, [token, router, fetchPending, fetchWorkload, fetchDevopsUsers]);

  const handleApprove = (id: number) => {
    setActioningId(id);
    fetch(`${apiUrl}/api/devops/requests/${id}/approve`, { method: 'POST', headers })
      .then((res) => res.json())
      .then((data) => {
        if (data?.status === 'ok') {
          fetchPending();
          fetchWorkload();
          window.dispatchEvent(new CustomEvent('devops-notifications-refresh'));
        } else {
          setError(data?.error || 'Approve failed');
        }
      })
      .catch(() => setError('Approve request failed'))
      .finally(() => setActioningId(null));
  };

  const handleReject = (id: number, reason?: string) => {
    setActioningId(id);
    fetch(`${apiUrl}/api/devops/requests/${id}/reject`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || '' }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.status === 'ok') {
          fetchPending();
          window.dispatchEvent(new CustomEvent('devops-notifications-refresh'));
        } else {
          setError(data?.error || 'Reject failed');
        }
      })
      .catch(() => setError('Reject request failed'))
      .finally(() => setActioningId(null));
  };

  return (
    <>
      <Head>
        <title>Workload - InfraGate DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="container">
          <h1 className="page-title">Workload</h1>

          {/* Pending your approval (DevOps manager) */}
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Pending your approval</h2>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 16, fontSize: 14 }}>
              Requests approved by user managers, waiting for DevOps manager approval.
            </p>
            {pendingLoading ? (
              <p className="loading-text">Loading…</p>
            ) : pendingApprovals.length === 0 ? (
              <div className="card">
                <div className="empty-state">
                  <p>No requests pending approval.</p>
                </div>
              </div>
            ) : (
              <div className="card">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Ticket #</th>
                        <th>Team</th>
                        <th>Env</th>
                        <th>Cloud</th>
                        <th>Service</th>
                        <th>Priority</th>
                        <th>Updated</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingApprovals.map((req) => (
                        <tr key={req.id}>
                          <td><code>#{req.id}</code></td>
                          <td>{req.team}</td>
                          <td>{req.env}</td>
                          <td>{req.cloud}</td>
                          <td>{req.service}</td>
                          <td>{req.priority}</td>
                          <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{new Date(req.updated_at).toLocaleString()}</td>
                          <td>
                            <button type="button" className="btn btn-primary btn-sm" disabled={actioningId === req.id} onClick={() => handleApprove(req.id)}>
                              {actioningId === req.id ? '…' : 'Approve'}
                            </button>
                            {' '}
                            <button type="button" className="btn btn-secondary btn-sm" disabled={actioningId === req.id} onClick={() => handleReject(req.id)}>
                              Reject
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* All in-progress tickets (assigned and unassigned) */}
          <section>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>All in-progress tickets</h2>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 16, fontSize: 14 }}>
              All tickets currently in progress. Unassigned tickets show until a DevOps user with the matching level (e.g. L4 for Critical) is available.
            </p>

            {/* Tickets by user – who has how many tickets and status breakdown */}
            {!loading && workload.length > 0 && (
              <div className="card" style={{ marginBottom: 24, padding: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Tickets by user</h3>
                <div className="table-wrap">
                  <table style={{ fontSize: 14 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '8px 12px' }}>User</th>
                        <th style={{ textAlign: 'center', padding: '8px 12px' }}>Total</th>
                        <th style={{ textAlign: 'center', padding: '8px 12px' }}>In progress</th>
                        <th style={{ textAlign: 'center', padding: '8px 12px' }}>Completed</th>
                        <th style={{ textAlign: 'center', padding: '8px 12px' }}>Rejected</th>
                        <th style={{ textAlign: 'left', padding: '8px 12px' }}>Other</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userStats.map(({ userId, username, total, byStatus }) => (
                        <tr
                          key={userId}
                          style={{
                            cursor: 'pointer',
                            background: filterUserId === String(userId) ? 'var(--color-primary-tint, #e8f4fc)' : undefined,
                          }}
                          onClick={() => setFilterUserId(filterUserId === String(userId) ? '' : String(userId))}
                        >
                          <td style={{ padding: '8px 12px', fontWeight: 500 }}>{userId === 0 ? 'Unassigned' : username}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>{total}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>{byStatus['in_progress'] ?? 0}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>{byStatus['completed'] ?? 0}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>{byStatus['rejected'] ?? 0}</td>
                          <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)' }}>
                            {Object.entries(byStatus)
                              .filter(([s]) => !['in_progress', 'completed', 'rejected'].includes(s))
                              .map(([s, n]) => `${s}: ${n}`)
                              .join(', ') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Filter – by user and status */}
            <div className="card" style={{ marginBottom: 24, padding: 16 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Filter</h3>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>DevOps user:</span>
                  <select
                    value={filterUserId}
                    onChange={(e) => setFilterUserId(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--color-border)', minWidth: 180 }}
                  >
                    <option value="">All users ({workload.length})</option>
                    {workload.some((w) => w.assignee_id === 0) && (
                      <option value="0">Unassigned ({workload.filter((w) => w.assignee_id === 0).length})</option>
                    )}
                    {devopsUsers.map((u) => {
                      const count = userStats.find((s) => s.userId === u.id)?.total ?? 0;
                      return (
                        <option key={u.id} value={String(u.id)}>{u.username} ({count})</option>
                      );
                    })}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>Status:</span>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--color-border)', minWidth: 160 }}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
                {(filterUserId || filterStatus) && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setFilterUserId(''); setFilterStatus(''); }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>
            {error && <div className="alert alert-error">{error}</div>}
            {loading ? (
              <p className="loading-text">Loading…</p>
            ) : (() => {
              const filtered = workload.filter((item) => {
                if (filterUserId && item.assignee_id !== Number(filterUserId)) return false;
                if (filterStatus && item.request.status !== filterStatus) return false;
                return true;
              });
              return filtered.length === 0 ? (
                <div className="card">
                  <div className="empty-state">
                    <p>{workload.length === 0 ? 'No in-progress tickets.' : 'No tickets match the selected filters.'}</p>
                  </div>
                </div>
              ) : (
                <div className="card">
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Assignee</th>
                          <th>Ticket #</th>
                          <th>Team</th>
                          <th>Env</th>
                          <th>Cloud</th>
                          <th>Service</th>
                          <th>Priority</th>
                          <th>Status</th>
                          <th>PR</th>
                          <th>Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((item) => (
                        <tr key={item.request.id}>
                          <td style={{ fontWeight: 500 }}>{item.assignee_id === 0 ? 'Unassigned' : item.assignee_username}</td>
                          <td><code>#{item.request.id}</code></td>
                          <td>{item.request.team}</td>
                          <td>{item.request.env}</td>
                          <td>{item.request.cloud}</td>
                          <td>{item.request.service}</td>
                          <td>{item.request.priority}</td>
                          <td>{item.request.status}</td>
                          <td>{item.request.pr_url ? <a href={item.request.pr_url} target="_blank" rel="noopener noreferrer">Open PR</a> : '-'}</td>
                          <td style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{new Date(item.request.updated_at).toLocaleString()}</td>
                        </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </section>
        </div>
      </DevOpsLayout>
    </>
  );
}
