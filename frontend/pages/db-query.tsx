import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AppLayout from '../components/AppLayout';
import { useToast } from '../context/ToastContext';

interface Connection {
  id: number;
  alias: string;
  db_type: string;
}

interface QueryRequest {
  id: number;
  connection_alias: string;
  db_type: string;
  query_text: string;
  status: string;
  submitted_at: string;
  result_summary?: string;
  result_rows?: string;
  error_message?: string;
  approved_at?: string;
  executed_at?: string;
}

export default function DbQueryPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState<number>(0);
  const [queryText, setQueryText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<QueryRequest[]>([]);
  const [loadingConn, setLoadingConn] = useState(true);
  const [loadingReq, setLoadingReq] = useState(true);
  const [selectedResult, setSelectedResult] = useState<QueryRequest | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    fetch(`${apiUrl}/api/db-query/connections`, { headers })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'ok' && Array.isArray(data.connections)) {
          setConnections(data.connections);
          if (data.connections.length > 0 && connectionId === 0) {
            setConnectionId(data.connections[0].id);
          }
        }
      })
      .catch(() => toast?.('Failed to load connections', 'error'))
      .finally(() => setLoadingConn(false));

    fetch(`${apiUrl}/api/db-query/my-requests`, { headers })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'ok' && Array.isArray(data.requests)) {
          setRequests(data.requests);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingReq(false));
  }, [apiUrl, router]);

  const handleSubmit = () => {
    if (!connectionId || !queryText.trim()) {
      toast?.('Select a connection and enter a query', 'error');
      return;
    }
    setSubmitting(true);
    const token = localStorage.getItem('token');
    fetch(`${apiUrl}/api/db-query/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ connection_id: connectionId, query_text: queryText.trim() }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          toast?.(data.error, 'error');
          return;
        }
        if (data.status === 'ok') {
          toast?.('Query submitted for DevOps manager approval', 'success');
          setQueryText('');
          setRequests((prev) => [
            {
              id: data.id,
              connection_alias: connections.find((c) => c.id === connectionId)?.alias || '',
              db_type: connections.find((c) => c.id === connectionId)?.db_type || '',
              query_text: queryText,
              status: 'pending_approval',
              submitted_at: new Date().toISOString(),
            },
            ...prev,
          ]);
        }
      })
      .catch(() => toast?.('Failed to submit', 'error'))
      .finally(() => setSubmitting(false));
  };

  const statusBadge = (s: string) => {
    const cls =
      s === 'executed' ? 'success' : s === 'rejected' || s === 'failed' ? 'danger' : 'secondary';
    return (
      <span
        style={{
          padding: '4px 8px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          background: `var(--color-${cls}-bg)`,
          color: `var(--color-${cls})`,
        }}
      >
        {s}
      </span>
    );
  };

  return (
    <>
      <Head>
        <title>DB Query - InfraGate</title>
      </Head>
      <AppLayout>
        <div className="container" style={{ maxWidth: 900 }}>
          <h1 className="page-title" style={{ marginBottom: 24 }}>
            DB Query
          </h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24 }}>
            Run read-only queries against approved databases. Queries require DevOps manager
            approval before execution.
          </p>

          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>Submit Query</h2>
            {loadingConn ? (
              <p className="loading-text">Loading connections…</p>
            ) : connections.length === 0 ? (
              <p className="empty-state">
                No database connections available. Contact your admin to add connections.
              </p>
            ) : (
              <>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
                  Connection
                </label>
                <select
                  value={connectionId}
                  onChange={(e) => setConnectionId(Number(e.target.value))}
                  className="input"
                  style={{ marginBottom: 16, minWidth: 200 }}
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.alias} ({c.db_type})
                    </option>
                  ))}
                </select>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>
                  SQL Query (SELECT only)
                </label>
                <textarea
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  className="input"
                  placeholder="SELECT * FROM users LIMIT 10"
                  rows={6}
                  style={{ fontFamily: 'monospace', marginBottom: 16 }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSubmit}
                  disabled={submitting || !queryText.trim()}
                >
                  {submitting ? 'Submitting…' : 'Submit for Approval'}
                </button>
              </>
            )}
          </div>

          <div className="card">
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>My Query Requests</h2>
            {loadingReq ? (
              <p className="loading-text">Loading…</p>
            ) : requests.length === 0 ? (
              <p className="empty-state">No queries submitted yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Connection</th>
                      <th>Status</th>
                      <th>Submitted</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id}>
                        <td>{r.id}</td>
                        <td>{r.connection_alias} ({r.db_type})</td>
                        <td>{statusBadge(r.status)}</td>
                        <td style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                          {new Date(r.submitted_at).toLocaleString()}
                        </td>
                        <td>
                          {(r.status === 'executed' && (r.result_summary || r.result_rows)) ||
                          r.error_message ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '4px 12px', fontSize: 12 }}
                              onClick={() => setSelectedResult(r)}
                            >
                              View result
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {selectedResult && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => setSelectedResult(null)}
          >
            <div
              className="card"
              style={{ maxWidth: 700, maxHeight: '80vh', overflow: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3>Query #{selectedResult.id} Result</h3>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedResult(null)}
                >
                  Close
                </button>
              </div>
              {selectedResult.error_message ? (
                <pre style={{ background: 'var(--color-danger-bg)', padding: 12, borderRadius: 8, overflow: 'auto' }}>
                  {selectedResult.error_message}
                </pre>
              ) : selectedResult.result_rows ? (
                <pre style={{ background: 'var(--color-bg)', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12 }}>
                  {selectedResult.result_rows}
                </pre>
              ) : (
                <p>{selectedResult.result_summary || 'No result data.'}</p>
              )}
            </div>
          </div>
        )}
      </AppLayout>
    </>
  );
}
