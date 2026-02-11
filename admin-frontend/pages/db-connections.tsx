import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import AdminLayout from '../components/AdminLayout';

interface Connection {
  id: number;
  alias: string;
  db_type: string;
  host: string;
  port: number;
  database_name: string;
  username: string;
  enabled: boolean;
}

export default function DbConnectionsPage() {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    alias: '',
    db_type: 'postgres',
    host: '',
    port: 5432,
    database_name: '',
    username: '',
    password: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetch(`${apiUrl}/api/admin/db-connections`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 'ok' && Array.isArray(data.connections)) {
          setConnections(data.connections);
        }
      })
      .finally(() => setLoading(false));
  }, [token, router, apiUrl]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    fetch(`${apiUrl}/api/admin/db-connections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(form),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          alert(data.error);
          return;
        }
        if (data.status === 'ok') {
          setForm({ alias: '', db_type: 'postgres', host: '', port: 5432, database_name: '', username: '', password: '' });
          setShowForm(false);
          setConnections((prev) => [
            ...prev,
            {
              id: data.id,
              alias: form.alias,
              db_type: form.db_type,
              host: form.host,
              port: form.port,
              database_name: form.database_name,
              username: form.username,
              enabled: true,
            },
          ]);
        }
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <>
      <Head>
        <title>DB Connections - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container" style={{ maxWidth: 900 }}>
          <h1 className="page-title" style={{ marginBottom: 24 }}>
            DB Connections
          </h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24 }}>
            Configure database connections for the DB Query feature. Users can run read-only queries
            against these connections after DevOps manager approval.
          </p>

          <button
            type="button"
            className="btn btn-primary"
            style={{ marginBottom: 24 }}
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? 'Cancel' : 'Add connection'}
          </button>

          {showForm && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, marginBottom: 16 }}>New connection</h2>
              <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Alias *</label>
                    <input
                      type="text"
                      className="input"
                      value={form.alias}
                      onChange={(e) => setForm((f) => ({ ...f, alias: e.target.value }))}
                      placeholder="prod-postgres"
                      required
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>DB Type *</label>
                    <select
                      className="input"
                      value={form.db_type}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          db_type: e.target.value,
                          port: e.target.value === 'mysql' ? 3306 : 5432,
                        }))
                      }
                    >
                      <option value="postgres">PostgreSQL</option>
                      <option value="mysql">MySQL</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Host *</label>
                    <input
                      type="text"
                      className="input"
                      value={form.host}
                      onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                      placeholder="localhost or hostname"
                      required
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Port</label>
                    <input
                      type="number"
                      className="input"
                      value={form.port}
                      onChange={(e) => setForm((f) => ({ ...f, port: parseInt(e.target.value, 10) || 5432 }))}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Database name *</label>
                    <input
                      type="text"
                      className="input"
                      value={form.database_name}
                      onChange={(e) => setForm((f) => ({ ...f, database_name: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Username *</label>
                    <input
                      type="text"
                      className="input"
                      value={form.username}
                      onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                      required
                    />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Password *</label>
                    <input
                      type="password"
                      className="input"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Adding…' : 'Add connection'}
                </button>
              </form>
            </div>
          )}

          <div className="card">
            {loading ? (
              <p className="loading-text">Loading…</p>
            ) : connections.length === 0 ? (
              <p className="empty-state">No DB connections configured. Add one above.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Alias</th>
                      <th>Type</th>
                      <th>Host</th>
                      <th>Port</th>
                      <th>Database</th>
                      <th>Username</th>
                      <th>Enabled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connections.map((c) => (
                      <tr key={c.id}>
                        <td>{c.alias}</td>
                        <td>{c.db_type}</td>
                        <td>{c.host}</td>
                        <td>{c.port}</td>
                        <td>{c.database_name}</td>
                        <td>{c.username}</td>
                        <td>{c.enabled ? 'Yes' : 'No'}</td>
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
