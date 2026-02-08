import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useToast } from '../context/ToastContext';
import { getStoredTheme, setStoredTheme } from '../components/NavBar';

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

      if (!data.user?.verified) {
        toast('Please verify your email to access the portal.', 'success');
        router.push('/verify-required');
        return;
      }

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
      <div className="auth-page">
        <button
          type="button"
          onClick={toggleTheme}
          className="btn btn-secondary"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            padding: '8px 14px',
            fontSize: 14,
            borderRadius: 8,
          }}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>
        <div className="auth-card">
          <div className="auth-header">
            <h1 className="auth-title">InfraGate</h1>
            <p className="auth-subtitle">Sign in to your account</p>
          </div>

          {error && (
            <div className="error">
              {error}
              {error.includes('Cannot connect') && (
                <p style={{ marginTop: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
                  Backend URL: <code style={{ background: 'var(--bg-gray-100)', padding: '2px 6px', borderRadius: '4px' }}>{apiUrl}</code>
                </p>
              )}
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={loading}
                placeholder="Enter your username"
                autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                placeholder="Enter your password"
                autoComplete="current-password"
              />
            </div>
            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span className="loading" style={{ width: 18, height: 18, borderWidth: 2 }} />
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <p style={{ marginTop: 24, fontSize: 14, color: 'var(--text-muted)' }}>
            Contact your administrator for access. Sign-up is disabled.
          </p>
        </div>
      </div>
    </>
  );
}
