import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

interface PendingRequest {
  id: number;
  user_id: number;
  submitter: string;
  connection_alias: string;
  db_type: string;
  query_text: string;
  submitted_at: string;
}

export default function DbQueryPendingPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('devops_token');
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/db-query/pending`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'ok' && Array.isArray(data.requests)) {
          setRequests(data.requests);
        }
      })
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

  const refresh = () => {
    setLoading(true);
    const token = localStorage.getItem('devops_token');
    fetch(`${apiUrl}/api/devops/db-query/pending`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'ok' && Array.isArray(data.requests)) {
          setRequests(data.requests);
        }
      })
      .finally(() => setLoading(false));
  };

  const handleApprove = (id: number) => {
    setActing(id);
    const token = localStorage.getItem('devops_token');
    fetch(`${apiUrl}/api/devops/db-query/${id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          alert(data.error);
          return;
        }
        refresh();
        window.dispatchEvent(new Event('devops-notifications-refresh'));
      })
      .finally(() => setActing(null));
  };

  const handleReject = (id: number) => {
    if (!confirm('Reject this query request?')) return;
    setActing(id);
    const token = localStorage.getItem('devops_token');
    fetch(`${apiUrl}/api/devops/db-query/${id}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          alert(data.error);
          return;
        }
        refresh();
        window.dispatchEvent(new Event('devops-notifications-refresh'));
      })
      .finally(() => setActing(null));
  };

  return (
    <>
      <Head>
        <title>Query Approvals - DevOps Portal</title>
      </Head>
      <DevOpsLayout>
        <div className="container" style={{ maxWidth: 1000 }}>
          <h1 className="page-title" style={{ marginBottom: 24 }}>
            DB Query Approvals
          </h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24 }}>
            Approve or reject user-submitted database queries. Approved queries are executed
            immediately.
          </p>

          <div className="card">
            {loading ? (
              <p className="loading-text">Loading…</p>
            ) : requests.length === 0 ? (
              <p className="empty-state">No pending query requests.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Submitter</th>
                      <th>Connection</th>
                      <th>Query</th>
                      <th>Submitted</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id}>
                        <td>{r.id}</td>
                        <td>{r.submitter || `User #${r.user_id}`}</td>
                        <td>{r.connection_alias} ({r.db_type})</td>
                        <td>
                          <pre
                            style={{
                              margin: 0,
                              maxWidth: 400,
                              overflow: 'auto',
                              fontSize: 12,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                            }}
                          >
                            {r.query_text}
                          </pre>
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(r.submitted_at).toLocaleString()}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ padding: '4px 12px', fontSize: 12 }}
                              onClick={() => handleApprove(r.id)}
                              disabled={acting === r.id}
                            >
                              {acting === r.id ? 'Running…' : 'Approve & Run'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '4px 12px', fontSize: 12 }}
                              onClick={() => handleReject(r.id)}
                              disabled={acting === r.id}
                            >
                              Reject
                            </button>
                          </div>
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
