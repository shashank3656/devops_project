import { useCallback, useEffect, useState } from 'react';
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

export default function DevOpsWorkload() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [pendingApprovals, setPendingApprovals] = useState<Request[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [workload, setWorkload] = useState<WorkloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState<number | null>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem(DEVOPS_TOKEN_KEY) : null;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

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

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchPending();
    fetchWorkload();
  }, [token, router, fetchPending, fetchWorkload]);

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
                        <th>ID</th>
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
                          <td><code>{req.application_id || req.id}</code></td>
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

          {/* Assigned workload */}
          <section>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Assigned tickets</h2>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
              Requests that have been assigned to DevOps team members.
            </p>
            {error && <div className="alert alert-error">{error}</div>}
            {loading ? (
              <p className="loading-text">Loading…</p>
            ) : workload.length === 0 ? (
              <div className="card">
                <div className="empty-state">
                  <p>No assigned tickets yet.</p>
                </div>
              </div>
            ) : (
              <div className="card">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Assignee</th>
                        <th>ID</th>
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
                      {workload.map((item) => (
                        <tr key={item.request.id}>
                          <td style={{ fontWeight: 500 }}>{item.assignee_username}</td>
                          <td><code>{item.request.application_id || item.request.id}</code></td>
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
            )}
          </section>
        </div>
      </DevOpsLayout>
    </>
  );
}
