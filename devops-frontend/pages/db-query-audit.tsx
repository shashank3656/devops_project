import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import DevOpsLayout from '../components/DevOpsLayout';
import { useApiUrl } from '../context/ApiUrlContext';

interface AuditEntry {
  id: number;
  user_id: number;
  submitter: string;
  connection_alias: string;
  db_type: string;
  query_text: string;
  status: string;
  approved_by: number | null;
  approver: string;
  submitted_at: string;
  approved_at: string;
  executed_at: string;
  result_summary: string;
  error_message: string;
}

export default function DbQueryAuditPage() {
  const router = useRouter();
  const apiUrl = useApiUrl();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('devops_token');
    if (!token || token === 'undefined') {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/devops/db-query/audit`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'ok' && Array.isArray(data.entries)) {
          setEntries(data.entries);
        }
      })
      .finally(() => setLoading(false));
  }, [apiUrl, router]);

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
        <title>Query Audit - DevOps Portal</title>
      </Head>
      <DevOpsLayout>
        <div className="container" style={{ maxWidth: 1200 }}>
          <h1 className="page-title" style={{ marginBottom: 24 }}>
            DB Query Audit
          </h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24 }}>
            Full audit trail: who ran the query, who approved it, and when.
          </p>

          <div className="card">
            {loading ? (
              <p className="loading-text">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="empty-state">No query audit entries yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Submitter</th>
                      <th>Connection</th>
                      <th>Status</th>
                      <th>Approved by</th>
                      <th>Submitted</th>
                      <th>Approved</th>
                      <th>Executed</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id}>
                        <td>{e.id}</td>
                        <td>{e.submitter || `User #${e.user_id}`}</td>
                        <td>{e.connection_alias} ({e.db_type})</td>
                        <td>{statusBadge(e.status)}</td>
                        <td>{e.approver || (e.approved_by ? `User #${e.approved_by}` : '—')}</td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(e.submitted_at).toLocaleString()}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                          {e.approved_at ? new Date(e.approved_at).toLocaleString() : '—'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                          {e.executed_at ? new Date(e.executed_at).toLocaleString() : '—'}
                        </td>
                        <td style={{ fontSize: 12, maxWidth: 200 }}>
                          {e.error_message ? (
                            <span style={{ color: 'var(--color-danger)' }} title={e.error_message}>
                              {e.error_message.slice(0, 50)}…
                            </span>
                          ) : (
                            e.result_summary || '—'
                          )}
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
