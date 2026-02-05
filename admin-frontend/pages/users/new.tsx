import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../components/AdminLayout';

export default function NewUser() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'viewer' | 'contributor'>('viewer');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('admin_token')}`,
        },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          password,
          role,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        router.push('/users');
        return;
      }
      setError(data.error || 'Failed to create user');
    } catch (_) {
      setError('Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Add user - Admin</title>
      </Head>
      <AdminLayout>
        <div className="container">
          <Link href="/users" className="back-link">
            ← Back to Users
          </Link>
          <div className="card" style={{ maxWidth: 480 }}>
            <h2 className="card-title">Add new user</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 24 }}>
              Create a user account. They can log in to the main portal and be added to teams.
            </p>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="label" htmlFor="user-username">
                  Username <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="user-username"
                  className="input"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder="e.g. jane"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="user-email">
                  Email <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="user-email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="e.g. jane@example.com"
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="user-password">
                  Password <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="user-password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Min 6 characters"
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="user-role">
                  Role
                </label>
                <select
                  id="user-role"
                  className="input"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'viewer' | 'contributor')}
                  style={{ maxWidth: 200 }}
                >
                  <option value="viewer">Viewer</option>
                  <option value="contributor">Contributor</option>
                </select>
                <span className="label-optional" style={{ display: 'block', marginTop: 4 }}>
                  Contributors can create PRs; viewers have read-only access.
                </span>
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                style={{ padding: '10px 24px' }}
              >
                {loading ? 'Creating…' : 'Create user'}
              </button>
            </form>
          </div>
        </div>
      </AdminLayout>
    </>
  );
}
