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
  const [pending2fa, setPending2fa] = useState<{ token: string } | null>(null);
  const [otp, setOtp] = useState('');

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
      if (data.requires_otp && data.pending_2fa_token) {
        setPending2fa({ token: data.pending_2fa_token });
        setError('');
        setPassword('');
        if (data.otp_for_testing) {
          toast(`OTP for testing: ${data.otp_for_testing}`, 'success');
        } else {
          toast('Enter the 6-digit code sent to your email', 'success');
        }
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

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending2fa || !otp.trim()) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/auth/verify-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pending_2fa_token: pending2fa.token, otp: otp.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Invalid OTP');
        toast(data.error || 'Invalid OTP', 'error');
        return;
      }
      if (!data.token) {
        setError('Verification failed');
        return;
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user || {}));
      localStorage.setItem('isAuthenticated', 'true');
      const teamsRes = await fetch(`${apiUrl}/api/me/teams`, { headers: { Authorization: `Bearer ${data.token}` } });
      const teamsData = await teamsRes.json().catch(() => ({}));
      const teams = teamsData.teams || [];
      if (teams.length === 0) {
        localStorage.removeItem('token');
        localStorage.removeItem('isAuthenticated');
        localStorage.removeItem('user');
        setError('403 Forbidden: You are not assigned to any team.');
        toast('Access forbidden. You are not in any team.', 'error');
        return;
      }
      toast('Welcome back!', 'success');
      router.push('/home');
    } catch (err: any) {
      setError(err?.message || 'Verification failed');
      toast('Verification failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Login - User</title>
      </Head>
      <div className="login-page">
        <div className="login-page__left">
          <div className="login-page__brand">
            <img src="/logo.svg" alt="" width={56} height={56} className="login-page__logo" />
            <h1 className="login-page__title">User</h1>
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
            {pending2fa ? (
              <form onSubmit={handleVerify2FA}>
                <p className="login-page__card-subtitle" style={{ marginBottom: '1rem' }}>
                  Enter the 6-digit code sent to your email
                </p>
                <div className="form-group">
                  <label className="label" htmlFor="otp">Verification code</label>
                  <input
                    id="otp"
                    className="input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    required
                    disabled={loading}
                    autoComplete="one-time-code"
                    autoFocus
                    placeholder="000000"
                  />
                </div>
                <button type="submit" className="btn btn-primary login-page__submit" disabled={loading || otp.length !== 6}>
                  {loading ? (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <span className="loading" style={{ width: 18, height: 18, borderWidth: 2 }} />
                      Verifying…
                    </span>
                  ) : (
                    'Verify'
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: '12px', width: '100%' }}
                  onClick={() => { setPending2fa(null); setOtp(''); setError(''); }}
                  disabled={loading}
                >
                  Back to login
                </button>
              </form>
            ) : (
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
            )}
            {!pending2fa && (
              <p style={{ marginTop: 12, fontSize: 13 }}>
                <a href="/forgot-password" style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>Forgot password?</a>
              </p>
            )}
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
