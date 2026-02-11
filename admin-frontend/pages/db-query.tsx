import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import AdminLayout from '../components/AdminLayout';

interface Connection {
  id: string;
  name: string;
}

export default function DbQueryPage() {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState('');
  const [query, setQuery] = useState('SELECT * FROM users LIMIT 10');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [rowCount, setRowCount] = useState(0);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/admin/db-connections`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load'))))
      .then((data) => {
        const conns = data.connections || [];
        setConnections(conns);
        if (conns.length > 0 && !connectionId) setConnectionId(conns[0].id);
      })
      .catch(() => setConnections([]));
  }, [token, router, apiUrl]);

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !query.trim()) return;
    setLoading(true);
    setError('');
    setColumns([]);
    setRows([]);
    try {
      const res = await fetch(`${apiUrl}/api/admin/db-query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ connection_id: connectionId || connections[0]?.id, query: query.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setColumns(data.columns || []);
        setRows(data.rows || []);
        setRowCount(data.count ?? 0);
        setError('');
      } else {
        setError(data.error || 'Query failed');
      }
    } catch (_) {
      setError('Failed to execute query');
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (columns.length === 0 || rows.length === 0) return;
    const header = columns.join(',');
    const lines = rows.map((r) =>
      columns.map((c) => {
        const v = r[c];
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    );
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query-result-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Head>
        <title>Database Query - InfraGate Admin</title>
      </Head>
      <AdminLayout>
        <div className="container" style={{ maxWidth: 1200 }}>
          <h1 className="page-title" style={{ marginBottom: 24 }}>Database Query</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
            Run read-only SELECT queries against configured databases. Max 1000 rows, 30s timeout.
          </p>

          <form onSubmit={handleExecute} className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', marginBottom: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Connection</label>
                <select
                  value={connectionId}
                  onChange={(e) => setConnectionId(e.target.value)}
                  className="input"
                  style={{ minWidth: 200 }}
                >
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Running…' : 'Execute'}
              </button>
              {rows.length > 0 && (
                <button type="button" className="btn btn-secondary" onClick={exportCsv}>
                  Export CSV
                </button>
              )}
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

          {error && (
            <div className="alert alert-error" role="alert">{error}</div>
          )}

          {columns.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, fontWeight: 600 }}>Results</h2>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{rowCount} rows</span>
              </div>
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      {columns.map((col) => (
                        <th key={col} style={{ whiteSpace: 'nowrap' }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i}>
                        {columns.map((col) => (
                          <td key={col} style={{ fontSize: 13, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(row[col] ?? '')}>
                            {row[col] == null ? '—' : String(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </AdminLayout>
    </>
  );
}
