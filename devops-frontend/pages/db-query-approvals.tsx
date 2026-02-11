import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

interface QueryRequest {
  id: number;
  connection_id: number;
  connection_name: string;
  project: string;
  query: string;
  requested_by: number;
  requester_name: string;
  status: string;
  created_at: string;
}

export default function DbQueryApprovalsPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [requests, setRequests] = useState<QueryRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);

  const token = typeof window !== 'undefined' ? localStorage.getItem('devops_token') : null;

  const fetchPending = () => {
    if (!token) return;
    fetch(`${apiUrl}/api/devops/db-query-pending`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed'))))
      .then((data) => setRequests(data.requests || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchPending();
  }, [token, router, apiUrl]);

  const handleApprove = async (id: number) => {
    if (!token) return;
    setApproving(id);
    try {
      const res = await fetch(`${apiUrl}/api/devops/db-query/${id}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchPending();
      }
    } finally {
      setApproving(null);
    }
  };

  const handleReject = async (id: number) => {
    if (!token || !confirm('Reject this query request?')) return;
    setRejecting(id);
    try {
      const res = await fetch(`${apiUrl}/api/devops/db-query/${id}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        fetchPending();
      }
    } finally {
      setRejecting(null);
    }
  };

  return (
    <>
      <Head>
        <title>DB Query Approvals - InfraGate DevOps</title>
      </Head>
      <DevOpsLayout>
        <div className="container" style={{ maxWidth: 1000 }}>
          <h1 className="page-title" style={{ marginBottom: 24 }}>DB Query approvals</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
            Approve or reject user-submitted database queries. Approved queries are executed immediately.
          </p>

          <div className="card">
            {loading ? (
              <p className="loading-text">Loading…</p>
            ) : requests.length === 0 ? (
              <div className="empty-state">No pending query requests.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Requester</th>
                      <th>Connection</th>
                      <th>Project</th>
                      <th>Query</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontSize: 13 }}>{new Date(r.created_at).toLocaleString()}</td>
                        <td>{r.requester_name}</td>
                        <td>{r.connection_name}</td>
                        <td>{r.project}</td>
                        <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace', fontSize: 12 }} title={r.query}>{r.query}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ fontSize: 12, padding: '4px 12px', marginRight: 8 }}
                            disabled={approving === r.id || rejecting === r.id}
                            onClick={() => handleApprove(r.id)}
                          >
                            {approving === r.id ? 'Executing…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: 12, padding: '4px 12px' }}
                            disabled={approving === r.id || rejecting === r.id}
                            onClick={() => handleReject(r.id)}
                          >
                            Reject
                          </button>
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
