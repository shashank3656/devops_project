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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message === 'Failed to fetch'
          ? `Cannot connect to backend at ${apiUrl}. Ensure it is running.`
          : message || 'Login failed'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Admin Login - InfraGate Admin</title>
      </Head>
      <div className="login-page">
        <div className="login-page__left">
          <div className="login-page__brand">
            <img src="/logo.svg" alt="" width={56} height={56} className="login-page__logo" />
            <h1 className="login-page__title">InfraGate Admin</h1>
            <p className="login-page__tagline">
              Cloud-agnostic infrastructure management. Secure, self-service, and audit-ready.
            </p>
          </div>
          <div className="login-page__decor">
            <div className="login-page__blob login-page__blob--1" />
            <div className="login-page__blob login-page__blob--2" />
            <div className="login-page__blob login-page__blob--3" />
          </div>
        </div>
        <div className="login-page__right">
          <div className="login-page__card">
            <h2 className="login-page__card-title">Welcome back</h2>
            <p className="login-page__card-subtitle">
              Sign in with your admin account
            </p>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="label" htmlFor="admin-username">
                  Username
                </label>
                <input
                  id="admin-username"
                  className="input"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  autoFocus
                  placeholder="admin"
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="admin-password">
                  Password
                </label>
                <input
                  id="admin-password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary login-page__submit"
                disabled={loading}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <p className="login-page__hint">
              Default: admin / admin123 — change after first login
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
