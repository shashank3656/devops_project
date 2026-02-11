import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminLayout from '../components/AdminLayout';

interface Connection {
  id: number;
  name: string;
  db_type: string;
  project: string;
  created_at: string;
}

export default function DbConnectionsPage() {
  const router = useRouter();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', db_type: 'postgres', project: 'default',
    host: '', port: '5432', username: '', password: '', database: '', ssl_mode: 'disable',
    mongo_collection: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  const fetchConnections = () => {
    if (!token) return;
    fetch(`${apiUrl}/api/admin/db-connections`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed'))))
      .then((data) => {
        setConnections(data.connections || []);
        setProjects(data.projects || []);
      })
      .catch(() => setConnections([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchConnections();
  }, [token, router, apiUrl]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/db-connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setShowForm(false);
        setForm({ name: '', db_type: 'postgres', project: 'default', host: '', port: '5432', username: '', password: '', database: '', ssl_mode: 'disable', mongo_collection: '' });
        fetchConnections();
      } else {
        setError(data.error || 'Failed to create');
      }
    } catch (_) {
      setError('Failed to create');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!token || !confirm('Delete this connection?')) return;
    const res = await fetch(`${apiUrl}/api/admin/db-connections/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) fetchConnections();
  };

  return (
    <>
      <Head>
        <title>DB Connections - InfraGate Admin</title>
      </Head>
      <AdminLayout>
        <div className="container" style={{ maxWidth: 900 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Database Connections</h1>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link href="/db-query" className="btn btn-secondary">DB Query</Link>
              <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>
                Add connection
              </button>
            </div>
          </div>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14 }}>
            Configure databases for the query UI. Supports PostgreSQL, MySQL, and MongoDB.
          </p>

          {error && <div className="alert alert-error">{error}</div>}

          {showForm && (
            <form onSubmit={handleCreate} className="card" style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, marginBottom: 16 }}>New connection</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Name (optional, for display only)</label>
                  <input type="text" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Analytics DB" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Database type</label>
                  <select className="input" value={form.db_type} onChange={(e) => {
                    const t = e.target.value;
                    const defaultPort = t === 'postgres' ? '5432' : t === 'mysql' ? '3306' : '27017';
                    setForm({ ...form, db_type: t, port: defaultPort });
                  }}>
                    <option value="postgres">PostgreSQL</option>
                    <option value="mysql">MySQL</option>
                    <option value="mongodb">MongoDB</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Project</label>
                  <input type="text" className="input" value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} placeholder="default" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Host</label>
                  <input type="text" className="input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required placeholder="localhost" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Port</label>
                  <input type="text" className="input" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} required placeholder={form.db_type === 'postgres' ? '5432' : form.db_type === 'mysql' ? '3306' : '27017'} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Username</label>
                  <input type="text" className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="user" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Password</label>
                  <input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Database</label>
                  <input type="text" className="input" value={form.database} onChange={(e) => setForm({ ...form, database: e.target.value })} required placeholder={form.db_type === 'mongodb' ? 'mydb' : 'mydb'} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>SSL mode</label>
                  <select className="input" value={form.ssl_mode} onChange={(e) => setForm({ ...form, ssl_mode: e.target.value })}>
                    <option value="disable">No SSL</option>
                    <option value="required">Required</option>
                  </select>
                </div>
                {form.db_type === 'mongodb' && (
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>MongoDB collection</label>
                    <input type="text" className="input" value={form.mongo_collection} onChange={(e) => setForm({ ...form, mongo_collection: e.target.value })} required placeholder="e.g. users" />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </form>
          )}

          <div className="card">
            {loading ? (
              <p className="loading-text">Loading…</p>
            ) : connections.length === 0 ? (
              <div className="empty-state">No connections. Add one to get started.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Project</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {connections.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>{c.db_type}</td>
                        <td>{c.project}</td>
                        <td>
                          <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => handleDelete(c.id)}>
                            Delete
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
      </AdminLayout>
    </>
  );
}
