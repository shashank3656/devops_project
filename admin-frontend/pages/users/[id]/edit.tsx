import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import AdminLayout from '../../../components/AdminLayout';

interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  verified: boolean;
  created_at?: string;
}

export default function EditUser() {
  const router = useRouter();
  const { id } = router.query;
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'contributor' | 'admin'>('viewer');
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    if (!token) {
      router.replace('/login');
      return;
    }
    if (id && typeof id === 'string') {
      fetchUser(parseInt(id, 10));
    }
  }, [token, id, router]);

  const fetchUser = async (userId: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.user) {
        setUser(data.user);
        setUsername(data.user.username || '');
        setEmail(data.user.email || '');
        setRole((data.user.role || 'viewer') as 'viewer' | 'contributor' | 'admin');
        setVerified(Boolean(data.user.verified));
      } else {
        setError(data.error || 'User not found');
      }
    } catch (_) {
      setError('Failed to load user');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || typeof id !== 'string') return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          username: username.trim(),
          email: email.trim(),
          role,
          verified,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push('/users');
        return;
      }
      setError(data.error || 'Failed to update user');
    } catch (_) {
      setError('Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  if (!id || Array.isArray(id)) return null;

  return (
    <>
      <Head>
        <title>Edit user - InfraGate Admin</title>
      </Head>
      <AdminLayout>
        <div className="container">
          <Link href="/users" className="back-link">
            ← Back to Users
          </Link>
          {loading ? (
            <p className="loading-text">Loading…</p>
          ) : error && !user ? (
            <div className="card">
              <div className="alert alert-error">{error}</div>
            </div>
          ) : user ? (
            <div className="card" style={{ maxWidth: 480 }}>
              <h2 className="card-title">Edit user profile</h2>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 24 }}>
                Update username, email, role, or verified status. Changes apply immediately.
              </p>
              {error && (
                <div className="alert alert-error" role="alert">
                  {error}
                </div>
              )}
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label className="label" htmlFor="edit-username">
                    Username <span style={{ color: 'var(--color-danger)' }}>*</span>
                  </label>
                  <input
                    id="edit-username"
                    className="input"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    placeholder="Username"
                  />
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="edit-email">
                    Email <span style={{ color: 'var(--color-danger)' }}>*</span>
                  </label>
                  <input
                    id="edit-email"
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="user@example.com"
                  />
                </div>
                <div className="form-group">
                  <label className="label" htmlFor="edit-role">
                    Role
                  </label>
                  <select
                    id="edit-role"
                    className="input"
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'viewer' | 'contributor' | 'admin')}
                    style={{ maxWidth: 200 }}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="contributor">Contributor</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={verified}
                      onChange={(e) => setVerified(e.target.checked)}
                    />
                    <span className="label">Verified (can log in without OTP)</span>
                  </label>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                  style={{ padding: '10px 24px' }}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </AdminLayout>
    </>
  );
}
