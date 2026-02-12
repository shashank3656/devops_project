import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useToast } from '../context/ToastContext';
import { getStoredTheme, setStoredTheme } from '../components/AppLayout';

export default function Login() {
  const router = useRouter();
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (t === 'undefined' || t === 'null') {
      localStorage.removeItem('token');
      localStorage.removeItem('isAuthenticated');
    }
  }, []);

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setStoredTheme(next);
    setTheme(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = data.error || `Server returned ${response.status}`;
        setError(msg);
        toast(msg, 'error');
        return;
      }
      if (!data.token) {
        setError(data.error || 'Login failed');
        toast(data.error || 'Login failed', 'error');
        return;
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user || {}));
      localStorage.setItem('isAuthenticated', 'true');

      const teamsRes = await fetch(`${apiUrl}/api/me/teams`, {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      const teamsData = await teamsRes.json().catch(() => ({}));
      const teams = teamsData.teams || [];
      if (teams.length === 0) {
        localStorage.removeItem('token');
        localStorage.removeItem('isAuthenticated');
        localStorage.removeItem('user');
        setError('403 Forbidden: You are not assigned to any team. Contact your administrator.');
        toast('Access forbidden. You are not in any team.', 'error');
        return;
      }
      toast('Welcome back!', 'success');
      router.push('/home');
    } catch (err: any) {
      const isNetworkError = err?.message === 'Failed to fetch' || err?.name === 'TypeError';
      const msg = isNetworkError
        ? `Cannot connect to the server. Ensure the backend is running at ${apiUrl} (check NEXT_PUBLIC_API_URL).`
        : (err?.message || 'An error occurred');
      setError(msg);
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Login - InfraGate</title>
      </Head>
      <div className="login-page">
        <div className="login-page__left">
          <div className="login-page__brand">
            <img src="/logo.svg" alt="" width={56} height={56} className="login-page__logo" />
            <h1 className="login-page__title">InfraGate</h1>
            <p className="login-page__tagline">
              Cloud-agnostic infrastructure management. Self-service requests for your team.
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
            <p className="login-page__card-subtitle">Sign in to your account</p>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
                {error.includes('Cannot connect') && (
                  <p style={{ marginTop: '8px', fontSize: '13px', opacity: 0.9 }}>
                    Backend URL: <code style={{ background: 'rgba(255,255,255,0.2)', padding: '2px 6px', borderRadius: '4px' }}>{apiUrl}</code>
                  </p>
                )}
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="label" htmlFor="username">Username</label>
                <input
                  id="username"
                  className="input"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="username"
                  autoFocus
                  placeholder="Enter your username"
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="password">Password</label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
              </div>
              <button type="submit" className="btn btn-primary login-page__submit" disabled={loading}>
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <span className="loading" style={{ width: 18, height: 18, borderWidth: 2 }} />
                    Signing in…
                  </span>
                ) : (
                  'Sign in'
                )}
              </button>
            </form>
            <p className="login-page__hint">
              Contact your administrator for access. Sign-up is disabled.
            </p>
            <button
              type="button"
              onClick={toggleTheme}
              className="btn btn-secondary"
              style={{ marginTop: 16, width: '100%' }}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
