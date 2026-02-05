import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function AdminLogin() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      if (!data.token) {
        setError('Login failed');
        return;
      }
      if (data.user?.role !== 'admin') {
        setError('Admin access only. Your account does not have admin role.');
        return;
      }
      localStorage.setItem('admin_token', data.token);
      localStorage.setItem('admin_user', JSON.stringify(data.user || {}));
      router.push('/teams');
    } catch (err: any) {
      setError(err?.message === 'Failed to fetch'
        ? `Cannot connect to backend at ${apiUrl}. Ensure it is running.`
        : (err?.message || 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head><title>Admin Login - Infrastructure Portal</title></Head>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div className="card" style={{ maxWidth: 400, width: '100%' }}>
          <h1 style={{ marginBottom: 8, fontSize: 24 }}>Admin Portal</h1>
          <p style={{ color: '#6b7280', marginBottom: 24 }}>Sign in with an admin account. Default: admin / admin123 (change after first login).</p>
          {error && <div className="error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <label className="label">Username</label>
            <input className="input" type="text" value={username} onChange={e => setUsername(e.target.value)} required style={{ marginBottom: 16 }} />
            <label className="label">Password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required style={{ marginBottom: 24 }} />
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
