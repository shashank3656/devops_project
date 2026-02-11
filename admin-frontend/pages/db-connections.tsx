import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AdminLayout from '../components/AdminLayout';

interface DBConnection {
  id: number;
  name: string;
  db_type: string;
  connection_string: string;
  team_id?: number;
  created_at: string;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export default function DBConnectionsPage() {
  const router = useRouter();
  const [connections, setConnections] = useState<DBConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('postgres');
  const [formConnStr, setFormConnStr] = useState('');
  const [formTeamId, setFormTeamId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchConnections();
  }, [token, router]);

  const fetchConnections = () => {
    fetch(`${apiUrl}/api/admin/db-connections`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.status === 401 || res.status === 403) router.replace('/login');
        return res.json();
      })
      .then((data) => {
        if (data.connections) setConnections(data.connections);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!formName.trim() || !formConnStr.trim()) {
      setError('Name and connection string required');
      return;
    }
    setSubmitting(true);
    const body: { name: string; db_type: string; connection_string: string; team_id?: number } = {
      name: formName.trim(),
      db_type: formType,
      connection_string: formConnStr.trim(),
    };
    if (formTeamId) {
      const tid = parseInt(formTeamId, 10);
      if (!isNaN(tid)) body.team_id = tid;
    }
    fetch(`${apiUrl}/api/admin/db-connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setShowForm(false);
        setFormName('');
        setFormConnStr('');
        setFormTeamId('');
        fetchConnections();
      })
      .catch(() => setError('Failed to add connection'))
      .finally(() => setSubmitting(false));
  };

  const maskConnStr = (s: string) => {
    if (!s || s.length < 20) return '***';
    return s.slice(0, 15) + '...' + s.slice(-5);
  };

  return (
    <>
      <Head>
        <title>DB Connections - InfraGate Admin</title>
      </Head>
      <AdminLayout>
        <div className="container" style={{ maxWidth: 900 }}>
          <h1 className="page-title" style={{ marginBottom: 24 }}>Database Connections</h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
            Configure database connections for Query Studio. Users in matching teams (or all teams if team_id is empty) can submit queries against these databases.
          </p>

          <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)} style={{ marginBottom: 24 }}>
            Add Connection
          </button>

          {showForm && (
            <div className="card" style={{ marginBottom: 24, padding: 24 }}>
              <h2 style={{ marginBottom: 16, fontSize: 18 }}>New connection</h2>
              {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Production DB"
                    className="input"
                    style={{ width: '100%', maxWidth: 400 }}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>DB Type</label>
                  <select value={formType} onChange={(e) => setFormType(e.target.value)} className="input" style={{ minWidth: 120 }}>
                    <option value="postgres">PostgreSQL</option>
                    <option value="mysql">MySQL</option>
                    <option value="mongodb">MongoDB</option>
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Connection string</label>
                  <input
                    type="password"
                    value={formConnStr}
                    onChange={(e) => setFormConnStr(e.target.value)}
                    placeholder="postgres://user:pass@host:5432/dbname"
                    className="input"
                    style={{ width: '100%', maxWidth: 500 }}
                  />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Team ID (optional)</label>
                  <input
                    type="text"
                    value={formTeamId}
                    onChange={(e) => setFormTeamId(e.target.value)}
                    placeholder="Leave empty for all teams"
                    className="input"
                    style={{ width: 120 }}
                  />
                </div>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Adding...' : 'Add'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} style={{ marginLeft: 8 }}>
                  Cancel
                </button>
              </form>
            </div>
          )}

          <div className="card">
            {loading ? (
              <p className="loading-text">Loading...</p>
            ) : connections.length === 0 ? (
              <div className="empty-state">No database connections configured. Add one to enable Query Studio.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Connection</th>
                      <th>Team</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connections.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>{c.db_type}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }} title={c.connection_string}>
                          {maskConnStr(c.connection_string)}
                        </td>
                        <td>{c.team_id ?? '—'}</td>
                        <td style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                          {new Date(c.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </AdminLayout>
    </>
  );
}
